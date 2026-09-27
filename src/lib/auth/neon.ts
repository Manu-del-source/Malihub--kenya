/**
 * Neon Auth (Managed Better Auth) provider adapter.
 *
 * ─── This is the ONLY module in MaliHub that imports the Neon SDK ───────────
 * Every provider call is made here and translated into MaliHub's own contract
 * (`AuthIdentity`, `AuthFailure`). Nothing else in the application — no page,
 * no Server Action, no service — imports `@neondatabase/auth`. That is what
 * makes the abstraction in `./index.ts` real rather than decorative: swapping
 * or rolling back the provider is a change to this file plus `./config.ts`, not
 * a sweep across forty call sites.
 *
 * ─── Runtime constraints ───────────────────────────────────────────────────
 * Imported by `src/middleware.ts`, so it must stay edge-safe: no Prisma, no
 * `server-only`, no Node-only APIs. The SDK reads `next/headers` lazily (only
 * when a session method is actually invoked), which is why the same module can
 * serve both middleware — where only `auth.middleware()` is called, with the
 * request passed in directly — and Server Actions/RSC, where the cookie-backed
 * methods are used.
 *
 * ─── Secrets ───────────────────────────────────────────────────────────────
 * Nothing here logs a session token, cookie value, password, or the cookie
 * secret. Provider failures are logged as a code + HTTP status only; the SDK's
 * own transport diagnostics stay at `warn` in production.
 *
 * @see https://neon.com/docs/auth/reference/nextjs-server
 */

import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getNeonAuthConfig } from "./config";
import { toAuthFailure, type ProviderError } from "./errors";
import type { AuthFailure, AuthIdentity } from "./types";

// ─── Instance ──────────────────────────────────────────────────────────────

let cached: NeonAuth | null = null;
let cachedFor: string | null = null;

/**
 * The Neon Auth instance, or `null` when it is not configured.
 *
 * Returning `null` rather than throwing is deliberate: middleware must be able
 * to *fail closed* on a misconfigured environment, and an exception thrown
 * from the edge runtime would surface as an opaque 500 on every request
 * instead of a clean redirect to sign-in.
 *
 * Memoized on the resolved configuration so a test (or a hot-reloading dev
 * server) that changes `NEON_AUTH_BASE_URL` gets a fresh instance instead of
 * silently keeping the old upstream.
 */
export function getNeonAuth(): NeonAuth | null {
  const config = getNeonAuthConfig();
  if (!config) {
    cached = null;
    cachedFor = null;
    return null;
  }

  const fingerprint = `${config.baseUrl}|${config.cookieSecret.length}`;
  if (cached && cachedFor === fingerprint) return cached;

  cached = createNeonAuth({
    baseUrl: config.baseUrl,
    cookies: { secret: config.cookieSecret },
    // `warn` in production keeps transport/misconfiguration failures visible
    // without the SDK's per-request debug chatter; `debug` locally.
    logLevel: process.env.NODE_ENV === "production" ? "warn" : "debug",
  });
  cachedFor = fingerprint;
  return cached;
}

/** Test/rollback seam: drops the memoized instance. */
export function resetNeonAuthCache(): void {
  cached = null;
  cachedFor = null;
}

// ─── Middleware ────────────────────────────────────────────────────────────

export type NeonAuthMiddleware = (request: import("next/server").NextRequest) => Promise<
  import("next/server").NextResponse<unknown>
>;

/**
 * Builds the SDK's route-protection middleware for a specific `loginUrl`.
 *
 * `loginUrl` is supplied per request (rather than fixed at boot) because the
 * SDK appends the request's own query parameters to it but never the path — so
 * MaliHub's `?redirectTo=` has to be baked into the login URL to survive the
 * bounce. Creating the middleware is a cheap closure over the memoized
 * instance, not a new client.
 *
 * This single function is responsible for THREE things, all verified against
 * the installed SDK's `processAuthMiddleware`:
 *  1. validating the signed `session_data` cookie locally (no network call),
 *  2. exchanging an OAuth/email-link return (`?neon_auth_session_verifier=…`
 *     plus the `session_challenge` cookie) for real session cookies on OUR
 *     origin — without this, Google sign-in would come back with no session,
 *  3. redirecting unauthenticated visitors to `loginUrl`, and failing CLOSED
 *     when the auth service is unreachable.
 */
export function createNeonAuthMiddleware(loginUrl: string): NeonAuthMiddleware | null {
  const auth = getNeonAuth();
  if (!auth) return null;
  return auth.middleware({ loginUrl }) as NeonAuthMiddleware;
}

// ─── Session ───────────────────────────────────────────────────────────────

/** Structural view of the SDK's `{ data: { session, user } }` payload. */
type ProviderSessionPayload = {
  session?: {
    id?: string | null;
    expiresAt?: Date | string | null;
  } | null;
  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    emailVerified?: boolean | null;
    image?: string | null;
  } | null;
} | null;

function isoDate(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

/**
 * Defensive mapping of a provider session onto MaliHub's `AuthIdentity`.
 *
 * Returns `null` — not a throw — for any payload that lacks a usable user id.
 * A malformed or partial upstream response must degrade to "not authenticated"
 * so the caller can fail closed, rather than crash a page.
 *
 * Exported for tests: this is the one piece of session handling worth
 * exercising without standing up the SDK.
 */
export function toAuthIdentity(payload: unknown): AuthIdentity | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as NonNullable<ProviderSessionPayload>;
  const user = record.user;
  const session = record.session;

  const authUserId = typeof user?.id === "string" ? user.id.trim() : "";
  if (!authUserId) return null;

  return {
    authUserId,
    email: typeof user?.email === "string" ? user.email.trim().toLowerCase() : "",
    name: typeof user?.name === "string" && user.name.trim() ? user.name.trim() : null,
    emailVerified: user?.emailVerified === true,
    image: typeof user?.image === "string" && user.image.trim() ? user.image : null,
    sessionId: typeof session?.id === "string" ? session.id : null,
    expiresAt: isoDate(session?.expiresAt),
  };
}

export type SessionResult =
  | { identity: AuthIdentity; failure: null }
  | { identity: null; failure: AuthFailure | null };

/**
 * Reads the current Neon Auth session.
 *
 * Three distinct outcomes, and callers must not collapse them:
 *  - `{ identity, failure: null }`      — authenticated.
 *  - `{ identity: null, failure: null }`— definitively signed out.
 *  - `{ identity: null, failure }`      — could not tell (service unreachable,
 *    misconfigured). Treated as unauthenticated by the guards, i.e. fail
 *    closed, but distinguishable so the user is not told they typed the wrong
 *    password.
 *
 * Served from the SDK's signed 5-minute `session_data` cookie whenever
 * possible, so this costs no network round trip on the hot path.
 */
export async function readAuthSession(): Promise<SessionResult> {
  const auth = getNeonAuth();
  if (!auth) {
    return { identity: null, failure: toAuthFailure(null, "auth_not_configured") };
  }

  try {
    const { data, error } = await auth.getSession();
    if (error) {
      return { identity: null, failure: toAuthFailure(error as ProviderError) };
    }
    const identity = toAuthIdentity(data);
    return { identity, failure: null };
  } catch (error) {
    // Non-transport failures are re-thrown by the SDK; treat them as
    // "cannot establish a session" rather than letting an exception escape
    // into a page render.
    return {
      identity: null,
      failure: toAuthFailure(
        { message: error instanceof Error ? error.message : String(error), status: 502 },
        "auth_unavailable"
      ),
    };
  }
}

// ─── Provider operations ───────────────────────────────────────────────────

export type ProviderResult<T> = { data: T | null; failure: AuthFailure | null };

/** Raw `{ data, error }` shape every SDK method returns. */
type SdkResult<T> = { data?: T | null; error?: ProviderError | null };

/**
 * Wraps a provider call so the three failure modes — not configured, provider
 * error, unexpected throw — all come back as the same `ProviderResult` shape.
 *
 * `fallbackCode` is the interpretation used when the provider reports something
 * `./errors` has no specific rule for, so a sign-in failure defaults to "wrong
 * password" and a token failure to "expired link".
 */
async function call<TIn, TOut>(
  operation: (auth: NeonAuth) => Promise<SdkResult<TIn>>,
  map: (data: TIn) => TOut | null,
  fallbackCode: AuthFailure["code"] = "unknown"
): Promise<ProviderResult<TOut>> {
  const auth = getNeonAuth();
  if (!auth) return { data: null, failure: toAuthFailure(null, "auth_not_configured") };

  try {
    const result = await operation(auth);
    if (result.error) {
      return { data: null, failure: toAuthFailure(result.error, fallbackCode) };
    }
    if (result.data === null || result.data === undefined) {
      return { data: null, failure: toAuthFailure(null, fallbackCode) };
    }
    const mapped = map(result.data);
    if (!mapped) {
      return { data: null, failure: toAuthFailure(null, fallbackCode) };
    }
    return { data: mapped, failure: null };
  } catch (error) {
    // Non-transport failures are re-thrown by the SDK rather than returned.
    // Reported as "could not reach the auth service" so callers fail closed
    // instead of telling someone their password was wrong.
    return {
      data: null,
      failure: toAuthFailure(
        { message: error instanceof Error ? error.message : String(error), status: 502 },
        "auth_unavailable"
      ),
    };
  }
}

/** The user payload a sign-up / sign-in / session response carries. */
type ProviderUserPayload = {
  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    emailVerified?: boolean | null;
    image?: string | null;
  } | null;
};

const toIdentityOrNothing = (data: ProviderUserPayload): AuthIdentity | null =>
  toAuthIdentity({ user: data.user ?? null, session: null });

const OK = true as const;

/**
 * Creates an email/password account and returns the new identity.
 *
 * `name` is required by the provider (`neon_auth.user.name` is NOT NULL), which
 * is why callers pass a fallback rather than leaving it empty.
 */
export function providerSignUp(input: {
  email: string;
  password: string;
  name: string;
}): Promise<ProviderResult<AuthIdentity>> {
  return call(
    (auth) =>
      auth.signUp.email({
        email: input.email,
        password: input.password,
        name: input.name,
      }) as Promise<SdkResult<ProviderUserPayload>>,
    toIdentityOrNothing,
    "email_taken"
  );
}

/** Verifies an email/password credential and establishes a session. */
export function providerSignIn(input: {
  email: string;
  password: string;
}): Promise<ProviderResult<AuthIdentity>> {
  return call(
    (auth) =>
      auth.signIn.email({
        email: input.email,
        password: input.password,
      }) as Promise<SdkResult<ProviderUserPayload>>,
    toIdentityOrNothing,
    "invalid_credentials"
  );
}

/**
 * Starts the Google OAuth flow and returns the provider URL to redirect the
 * browser to.
 *
 * `disableRedirect: true` is what makes this usable from a Server Action: the
 * auth service returns the Google authorize URL in the response body instead of
 * answering with a `Location` header that our `fetch` would have to interpret.
 * MaliHub then hands the URL to Next's `redirect()`.
 *
 * `callbackURL` is where the browser lands AFTER the auth service finishes the
 * handshake, and it must be on a trusted domain configured in the Neon Console.
 * Two production prerequisites follow from this and are documented in
 * docs/auth/MIGRATION.md §6:
 *   - Google's *authorized redirect URI* must be
 *     `{NEON_AUTH_BASE_URL}/callback/google` — the auth service's own endpoint,
 *     NOT a MaliHub route;
 *   - `callbackURL`'s origin must be on the branch's trusted-domain allowlist.
 */
export function providerSignInWithGoogle(input: {
  callbackURL: string;
}): Promise<ProviderResult<{ url: string }>> {
  return call(
    (auth) =>
      auth.signIn.social({
        provider: "google",
        callbackURL: input.callbackURL,
        disableRedirect: true,
      }) as Promise<SdkResult<{ url?: string | null }>>,
    (data) => (typeof data.url === "string" && data.url ? { url: data.url } : null),
    "unknown"
  );
}

/** Ends the session and clears both Neon Auth cookies. */
export function providerSignOut(): Promise<ProviderResult<true>> {
  return call(
    (auth) => auth.signOut() as Promise<SdkResult<unknown>>,
    () => OK,
    "unknown"
  );
}

/**
 * Emails a password-reset link.
 *
 * `redirectTo` is the MaliHub page the link eventually lands on; the auth
 * service appends `?token=…` (or `?error=INVALID_TOKEN` when the token has
 * expired — links live for 15 minutes). It must be an absolute URL on a trusted
 * domain.
 *
 * The provider does not reveal whether the address exists, so callers must keep
 * answering identically either way to avoid account enumeration.
 */
export function providerRequestPasswordReset(input: {
  email: string;
  redirectTo: string;
}): Promise<ProviderResult<true>> {
  return call(
    (auth) =>
      auth.requestPasswordReset({
        email: input.email,
        redirectTo: input.redirectTo,
      }) as Promise<SdkResult<unknown>>,
    () => OK,
    "unknown"
  );
}

/**
 * Completes a password reset using the token from the emailed link.
 *
 * Unlike the previous provider this is NOT a "change the password on my current
 * session" call — Better Auth consumes a one-time token, so the caller must
 * supply it. That is why `resetPasswordAction` now takes the token from the
 * `/reset-password` page's query string instead of reading a recovery session.
 */
export function providerResetPassword(input: {
  newPassword: string;
  token: string;
}): Promise<ProviderResult<true>> {
  return call(
    (auth) =>
      auth.resetPassword({
        newPassword: input.newPassword,
        token: input.token,
      }) as Promise<SdkResult<unknown>>,
    () => OK,
    "invalid_token"
  );
}

/**
 * Re-sends the verification EMAIL LINK.
 *
 * Requires a custom email provider to be configured on the Neon branch: with
 * the shared provider only verification CODES are available and the service
 * answers "Verification email isn't enabled", which `./errors` normalizes to
 * `capability_not_enabled`. Callers detect that with
 * `isVerificationEmailDisabled()` and fall back to
 * {@link providerSendVerificationCode}.
 */
export function providerSendVerificationEmail(input: {
  email: string;
  callbackURL?: string;
}): Promise<ProviderResult<true>> {
  return call(
    (auth) =>
      auth.sendVerificationEmail({
        email: input.email,
        ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
      }) as Promise<SdkResult<unknown>>,
    () => OK,
    "unknown"
  );
}

/** Sends a numeric verification CODE — works with the shared email provider. */
export function providerSendVerificationCode(input: {
  email: string;
}): Promise<ProviderResult<true>> {
  return call(
    (auth) =>
      auth.emailOtp.sendVerificationOtp({
        email: input.email,
        type: "email-verification",
      }) as Promise<SdkResult<unknown>>,
    () => OK,
    "unknown"
  );
}

/**
 * Redeems a numeric verification code, marking the address verified.
 *
 * The provider may also establish a session on success (auto-sign-in is its
 * default), which is why callers re-read the session afterwards rather than
 * assuming the person is still signed out.
 */
export function providerVerifyEmailWithCode(input: {
  email: string;
  otp: string;
}): Promise<ProviderResult<true>> {
  return call(
    (auth) =>
      auth.emailOtp.verifyEmail({
        email: input.email,
        otp: input.otp,
      }) as Promise<SdkResult<unknown>>,
    () => OK,
    "invalid_token"
  );
}
