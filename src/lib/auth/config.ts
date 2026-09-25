/**
 * MaliHub authentication configuration and route ownership.
 *
 * ─── Why this module exists ────────────────────────────────────────────────
 * Neon Auth (Managed Better Auth) is MaliHub's ONLY active authentication
 * provider. This module is the single place that knows (a) how to reach it and
 * (b) which MaliHub routes it is responsible for.
 *
 * ─── Edge-safety contract ──────────────────────────────────────────────────
 * `src/middleware.ts` imports this on the edge path for EVERY request, so this
 * file must stay dependency-free: no SDK import, no Prisma, no `server-only`,
 * no Next APIs. Environment variables and pure path/string logic only.
 * Anything that needs the Neon SDK lives in `./neon.ts`; anything that needs
 * the application database lives in `./session.ts`.
 *
 * ─── Environment variables ─────────────────────────────────────────────────
 * Both are SERVER-SIDE only. There is deliberately no `NEXT_PUBLIC_*` Neon
 * Auth variable: browser code never talks to the Auth service directly, it
 * goes through Server Actions. Verified against the installed SDK
 * (`@neondatabase/auth@0.5.0-beta`) and the official Next.js server SDK
 * reference — these are the documented names, not invented ones.
 *
 * @see https://neon.com/docs/auth/reference/nextjs-server
 * @see https://neon.com/docs/auth/quick-start/nextjs-api-only
 */

type Env = Record<string, string | undefined>;

// ─── Environment resolution ────────────────────────────────────────────────

function trimmed(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate ? candidate : null;
}

/**
 * Resolves the Neon Auth base URL — the "Auth URL" shown in the Neon Console
 * under Project → Branch → Auth → Configuration.
 *
 * `NEON_AUTH_BASE_URL` is the name the official SDK documentation uses.
 * `NEON_AUTH_URL` is accepted as an alias because that is the label the Neon
 * Console shows and older `.env` files may already carry it. Both are
 * server-side only; a `NEXT_PUBLIC_*` value is never honoured, so the Auth URL
 * can never be leaked into the browser bundle.
 */
/**
 * Placeholder strings copied out of `.env.example` verbatim.
 *
 * Treating one of these as "configured" is worse than treating it as absent: the
 * SDK would be constructed against a host that does not exist, every protected
 * request would fail as an outage, and the operator would be debugging a
 * networking problem when the real issue is an unfinished `.env`. Recognizing
 * the placeholder turns that into the honest "not configured" path.
 */
const PLACEHOLDER_HINTS = ["your-", "your_", "<", ">", "changeme", "placeholder", "xxx"];

function isPlaceholderUrl(value: string): boolean {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_HINTS.some((hint) => lower.includes(hint))) return true;
  try {
    const url = new URL(value);
    // Only a real http(s) origin can serve the auth API.
    return url.protocol !== "https:" && url.protocol !== "http:";
  } catch {
    // Not a URL at all — e.g. "my-auth-url" pasted where a URL was expected.
    return true;
  }
}

export function resolveNeonAuthBaseUrl(env: Env = process.env): string | null {
  const candidate = trimmed(env.NEON_AUTH_BASE_URL) ?? trimmed(env.NEON_AUTH_URL);
  if (!candidate) return null;
  return isPlaceholderUrl(candidate) ? null : candidate;
}

/** The SDK's own minimum for the HS256 signing secret. */
export const MIN_COOKIE_SECRET_LENGTH = 32;

/**
 * Resolves the secret used to sign the SDK's local `session_data` cookie.
 *
 * The SDK rejects anything shorter than 32 characters, so this module enforces
 * the same minimum rather than handing the SDK a value it will throw on at
 * request time. It also refuses to generate one: a secret that changed on every
 * deploy would silently invalidate every active session, which reads to users as
 * "MaliHub keeps signing me out".
 */
export function resolveNeonAuthCookieSecret(env: Env = process.env): string | null {
  const candidate = trimmed(env.NEON_AUTH_COOKIE_SECRET);
  if (!candidate) return null;
  if (candidate.length < MIN_COOKIE_SECRET_LENGTH) return null;
  if (PLACEHOLDER_HINTS.some((hint) => candidate.toLowerCase().includes(hint))) return null;
  return candidate;
}

export type NeonAuthConfig = {
  /** Neon Auth base URL from the Neon Console (Auth → Configuration). */
  baseUrl: string;
  /** HS256 secret for the SDK's signed session-data cookie (32+ characters). */
  cookieSecret: string;
};

/** Both required variables, or `null` when Neon Auth is not usable. */
export function getNeonAuthConfig(env: Env = process.env): NeonAuthConfig | null {
  const baseUrl = resolveNeonAuthBaseUrl(env);
  const cookieSecret = resolveNeonAuthCookieSecret(env);
  if (!baseUrl || !cookieSecret) return null;
  return { baseUrl, cookieSecret };
}

export function isNeonAuthConfigured(env: Env = process.env): boolean {
  return getNeonAuthConfig(env) !== null;
}

/**
 * Whether an authenticated Neon identity may claim an application user row that
 * was provisioned by the previous provider and is not yet mapped
 * (`auth_user_id IS NULL`), matched on email address.
 *
 * Defaults to FALSE. Existing accounts are NOT migrated automatically by this
 * change — that is an explicit, operator-run step described in
 * docs/auth/MIGRATION.md. Leaving this off means a legacy email address cannot
 * be silently attached to a brand-new Neon Auth identity; the user gets a clear
 * "your account is being migrated" message instead of a confusing crash or a
 * duplicate-account error.
 *
 * Flip it on only during the documented cutover window (or run the backfill),
 * and read MIGRATION.md §4 first.
 */
const TRUTHY_FLAG_VALUES = new Set(["true", "1", "yes", "on"]);

export function shouldLinkUnmappedAccountsByEmail(env: Env = process.env): boolean {
  const value = trimmed(env.MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL)?.toLowerCase();
  // Anything unrecognized — including a typo like "ture" — stays OFF. For a flag
  // whose "on" position can attach one person's account to another's, an
  // unrecognized value must never be read as consent.
  return value !== undefined && TRUTHY_FLAG_VALUES.has(value);
}

// ─── Route ownership ───────────────────────────────────────────────────────

/** Where unauthenticated visitors are sent. Carries `redirectTo` on the way. */
export const LOGIN_PATH = "/login";

/**
 * Routes that require an authenticated Neon Auth session.
 *
 * The SDK's own `auth.middleware()` protects *everything* except a hard-coded
 * skip list (`/api/auth`, `/auth/sign-in`, `/auth/sign-up`, …) that matches
 * none of MaliHub's routes — applied globally it would gate the landing page
 * and `/login` itself. MaliHub therefore decides which requests to hand to the
 * SDK, and this list is that decision.
 */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/messages",
  "/notifications",
] as const;

/**
 * Routes that establish or repair a session. They must stay reachable while
 * signed out, and they are never handed to the SDK's route protection.
 */
export const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/complete-profile",
] as const;

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** True for routes that require an authenticated session. */
export function isProtectedPath(pathname: string): boolean {
  return matchesPrefix(pathname, PROTECTED_PREFIXES);
}

/** True for sign-in/sign-up/password/profile-completion routes. */
export function isAuthRoutePath(pathname: string): boolean {
  return matchesPrefix(pathname, AUTH_ROUTE_PREFIXES);
}

/**
 * The query parameter the Neon Auth service appends when it sends the browser
 * back to `callbackURL` after an OAuth (or emailed-link) flow.
 *
 * Its presence is what makes the SDK middleware exchange the verifier for
 * session cookies on OUR origin — the exchange happens inside
 * `processAuthMiddleware()` before any route-protection decision, so a request
 * carrying this parameter must be handed to the SDK middleware even when its
 * path is not otherwise protected. Without that, Google sign-in would land the
 * browser back on MaliHub with no session cookie at all.
 *
 * Value verified against the installed SDK
 * (`NEON_AUTH_SESSION_VERIFIER_PARAM_NAME` in @neondatabase/auth).
 */
export const NEON_AUTH_VERIFIER_PARAM = "neon_auth_session_verifier";

/** True when this request is returning from an OAuth / emailed-link flow. */
export function isAuthReturnRequest(url: URL): boolean {
  return url.searchParams.has(NEON_AUTH_VERIFIER_PARAM);
}

/**
 * Strips the one-time verifier parameter so it is never persisted into a
 * `redirectTo` target, a log line, or a bookmarkable URL.
 */
export function pathWithoutVerifierParam(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete(NEON_AUTH_VERIFIER_PARAM);
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}
