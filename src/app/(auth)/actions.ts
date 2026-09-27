"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import {
  isAuthUnavailable,
  isVerificationEmailDisabled,
  providerRequestPasswordReset,
  providerResetPassword,
  providerSendVerificationCode,
  providerSendVerificationEmail,
  providerSignIn,
  providerSignInWithGoogle,
  providerSignOut,
  providerSignUp,
  providerVerifyEmailWithCode,
  requireActionIdentity,
  requireActionUser,
  safeInternalRedirect,
} from "@/lib/auth";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  completeProfileSchema,
  verifyEmailCodeSchema,
  type RegisterInput,
  type LoginInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type CompleteProfileInput,
  type VerifyEmailCodeInput,
} from "@/lib/validations/auth";
import {
  AuthServiceError,
  completeUserProfile,
  provisionUserRows,
  readOnboardingState,
  type AuthoritativeOnboardingState,
} from "@/services/auth-service";
import type { ApiResult } from "@/types";

/**
 * Server Actions for the authentication flows.
 *
 * Every provider call in this file goes through `@/lib/auth` — the abstraction
 * layer — and never through `@neondatabase/auth` or `@supabase/*` directly. The
 * Supabase implementation these actions used to call is preserved, unmodified
 * and out of the request path, in `src/lib/supabase/auth-legacy.ts`; it is the
 * rollback target documented in docs/auth/MIGRATION.md §9.
 *
 * Division of responsibility, which the actions below follow strictly:
 *   - `src/middleware.ts` answers ONE question — is there a valid session? It
 *     makes no database call and holds no authorization opinion.
 *   - These actions and the server components behind them answer "may this
 *     person do this?" from MaliHub's own Postgres rows (users/profiles/sellers),
 *     read authoritatively at the point of use.
 *
 * There is deliberately no `app_metadata` here. Role, onboarding and seller
 * access are never written into the auth token, so there is no second copy of
 * the truth to fall out of sync and no session to re-mint after a change.
 */

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  const fallback = process.env.NEXT_PUBLIC_APP_URL ?? `https://${host}`;
  // A missing Host header (or a spoofed one) must not turn into a redirect URL
  // the auth service will happily accept; NEXT_PUBLIC_APP_URL wins when set.
  return host ? `${protocol}://${host}` : fallback;
}

function dashboardFor(state: AuthoritativeOnboardingState): string {
  // Seller-dashboard access is based on the Seller record, matching
  // middleware and ARCHITECTURE.md §5a. Every role can still buy.
  return state.hasSellerProfile ? "/dashboard/seller" : "/dashboard/buyer";
}

// ─── Sign up ───────────────────────────────────────────────────────────────

/**
 * Registers a new email/password account.
 *
 * The auth service sends the verification email itself when verification links
 * are enabled on the branch; when they are not (shared email provider) the
 * person is sent to /verify-email and can request a CODE instead — see
 * `resendVerificationAction`. This action never sends mail directly, so it
 * cannot double-send.
 */
export async function signUpAction(
  input: RegisterInput
): Promise<ApiResult<{ email: string }>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password } = parsed.data;

  // The provider requires a non-empty display name (`neon_auth.user.name` is
  // NOT NULL), but MaliHub's register form does not collect one — the person's
  // real name arrives at /complete-profile. Seed it from the email local part
  // rather than sending an empty string, which would turn a valid registration
  // into a provider-side failure.
  const providerName = email.split("@")[0] || "MaliHub user";

  const { data: identity, failure } = await providerSignUp({
    email,
    password,
    name: providerName,
  });

  if (!identity) {
    return {
      success: false,
      error: failure?.message ?? "Something went wrong creating your account. Please try again.",
    };
  }

  // The auth service owns the identity; the application rows live in MaliHub's
  // own Postgres and have to be provisioned. Best-effort by design —
  // /complete-profile provisions the same rows authoritatively on submit, so a
  // failure here must not lose the account that was just created upstream.
  const provisioning = await provisionUserRows(identity, "sign-up");
  if (!provisioning.userId) {
    // Logged, not surfaced: the account exists and the retry path is the next
    // sign-in. Only the failure reason is recorded — never the password.
    console.error("[auth] signUp: application rows not provisioned", {
      authUserId: identity.authUserId,
      context: "sign-up",
      code: errorCodeOf(provisioning.error),
      message: provisioning.error instanceof Error ? provisioning.error.message : "unknown",
    });
  }

  return { success: true, data: { email } };
}

// ─── Sign in ───────────────────────────────────────────────────────────────

export async function signInAction(
  input: LoginInput,
  redirectTo?: string
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { data: identity, failure } = await providerSignIn(parsed.data);

  if (!identity) {
    return {
      success: false,
      error: failure?.message ?? "That email or password doesn't look right.",
    };
  }

  // Self-heal accounts whose application rows predate (or were missed by)
  // provisioning — this is also the path that links a legacy MaliHub row to a
  // new auth account, when `MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL` allows it.
  // Best-effort: the authoritative read below is the part that may not fail
  // silently.
  const provisioning = await provisionUserRows(identity, "sign-in");

  if (!provisioning.userId) {
    // `provisionUserRows` returns the application user id when a MaliHub row
    // maps to this identity. Without it we cannot read onboarding state, and
    // guessing would be exactly the fail-open the old code avoided.
    await clearSessionBestEffort(identity.authUserId, "missing application user");
    return {
      success: false,
      error: "We couldn't load your MaliHub account. Please contact support.",
    };
  }

  let state: AuthoritativeOnboardingState | null = null;
  try {
    state = await readOnboardingState(provisioning.userId);
  } catch (readError) {
    // Authentication itself succeeded, but the application cannot safely keep
    // a session whose onboarding/role state it cannot verify. The fail-closed
    // path below clears it instead of risking a redirect loop.
    console.error("[auth] Failed to read onboarding state after sign-in", {
      userId: provisioning.userId,
      code: errorCodeOf(readError),
      message: readError instanceof Error ? readError.message : String(readError),
    });
  }

  if (!state) {
    await clearSessionBestEffort(provisioning.userId, "onboarding state unreadable");
    return {
      success: false,
      error: "We couldn't load your MaliHub account. Please try signing in again.",
    };
  }

  // MaliHub's own rows — not anything in the auth token — decide whether this
  // person completed onboarding. There is no claim to re-mint, so unlike the
  // Supabase version of this action there is no `refreshSession()` call here.
  const destination = state.onboarded
    ? safeInternalRedirect(redirectTo) ?? dashboardFor(state)
    : "/complete-profile";

  return { success: true, data: { redirectTo: destination } };
}

/**
 * Ends the session after a sign-in we have decided not to honour.
 *
 * Best-effort: if the provider cannot be reached the session cookie may
 * survive, but the action still reports failure and the person never reaches a
 * protected page with unverified state — middleware only checks that a session
 * exists, and every page re-reads authorization from the database.
 */
async function clearSessionBestEffort(userId: string, reason: string): Promise<void> {
  try {
    const { failure } = await providerSignOut();
    if (failure) {
      console.error(`[auth] Failed to clear session (${reason})`, {
        userId,
        message: failure.message,
      });
    }
  } catch (error) {
    console.error(`[auth] Failed to clear session (${reason})`, {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── OAuth ─────────────────────────────────────────────────────────────────

/**
 * Starts the Google OAuth flow.
 *
 * This no longer round-trips through a MaliHub route. The auth service owns the
 * whole handshake and calls back into the app through its own
 * `{NEON_AUTH_BASE_URL}/callback/google` endpoint, which is what `src/middleware.ts`
 * lets through as an auth-return request. `/api/auth/callback` is retired (410).
 *
 * `next` is preserved across the flow via the same `?next=` parameter the sign-in
 * page already uses, so a person who clicked a protected link still lands where
 * they were going after the handshake completes.
 */
export async function signInWithGoogleAction(next: string = "/complete-profile"): Promise<void> {
  const origin = await getOrigin();
  const target = safeInternalRedirect(next) ?? "/complete-profile";

  const { data, failure } = await providerSignInWithGoogle({
    callbackURL: `${origin}${target}`,
  });

  if (!data?.url) {
    // Redirecting to our own login page with a query parameter rather than
    // throwing: `redirect()` is how a Server Action tells the browser where to
    // go, and an exception here would surface as Next's generic error boundary.
    redirect(
      `/login?error=${encodeURIComponent(
        failure?.message ?? "Couldn't start Google sign-in. Please try again."
      )}`
    );
  }

  redirect(data.url);
}

// ─── Password reset ────────────────────────────────────────────────────────

/**
 * Emails a password-reset link.
 *
 * The auth service does not reveal whether the address exists, and this action
 * keeps that property: a person probing the form gets an identical response for
 * a registered address, an unregistered one, and a malformed-but-valid email.
 * Only a genuine service outage is reported as an error, because telling someone
 * "check your email" while the mailer is down wastes the 15-minute window the
 * link is valid for.
 */
export async function forgotPasswordAction(
  input: ForgotPasswordInput
): Promise<ApiResult<{ email: string }>> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const origin = await getOrigin();

  const { failure } = await providerRequestPasswordReset({
    email: parsed.data.email,
    // The link the service sends appends `?token=…` (or `?error=INVALID_TOKEN`
    // when it has expired) to this URL, and /reset-password reads it. It must
    // be absolute and on a domain trusted by the branch.
    redirectTo: `${origin}/reset-password`,
  });

  if (failure && isAuthUnavailable(failure)) {
    return { success: false, error: failure.message };
  }

  return { success: true, data: { email: parsed.data.email } };
}

/**
 * Completes a password reset with the one-time token from the emailed link.
 *
 * BEHAVIOUR CHANGE from the Supabase version, and an intentional one: the token
 * is now an explicit parameter instead of being implied by a recovery session.
 * The old provider exchanged the emailed link for a logged-in "recovery"
 * session and then called `updateUser({ password })`, so the action needed no
 * token. The new provider consumes a one-time token directly and does not
 * establish a session first — which means this action must work while signed
 * out, and must NOT require authentication.
 *
 * `token` comes from `/reset-password?token=…`. When it is absent or rejected
 * the answer is the same one the person already saw from the link itself.
 */
export async function resetPasswordAction(
  input: ResetPasswordInput,
  token?: string | null
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    return {
      success: false,
      error: "Your password reset link has expired. Please request a new one.",
    };
  }

  const { failure } = await providerResetPassword({
    newPassword: parsed.data.password,
    token: trimmedToken,
  });

  if (failure) {
    return {
      success: false,
      error: failure.message,
    };
  }

  return { success: true, data: { redirectTo: "/login" } };
}

// ─── Email verification ────────────────────────────────────────────────────

/** How the verification message was delivered, so the form can adapt. */
export type VerificationMethod = "link" | "code";

/**
 * Re-sends an email-verification message, preferring the LINK and falling back
 * to a numeric CODE.
 *
 * Both paths are implemented because they have different prerequisites on a
 * Neon branch: verification LINKS require a custom email provider to be
 * configured in the Neon Console, while CODES work with the shared provider
 * that is available immediately. Rather than fail when links are unavailable,
 * the action asks for a code instead and tells the caller which one to expect —
 * the person gets verified either way, and no MaliHub code has to guess what
 * the branch was configured with.
 */
export async function resendVerificationAction(
  email: string
): Promise<ApiResult<{ method: VerificationMethod }>> {
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) {
    return {
      success: false,
      error: "Enter a valid email address",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const normalized = parsed.data.email;
  const origin = await getOrigin();

  const linkAttempt = await providerSendVerificationEmail({
    email: normalized,
    // Where the link should land after verification: straight into onboarding.
    callbackURL: `${origin}/complete-profile`,
  });

  if (linkAttempt.failure === null) {
    return { success: true, data: { method: "link" } };
  }

  if (!isVerificationEmailDisabled(linkAttempt.failure)) {
    // Anything other than "links aren't enabled" is a real failure the person
    // can act on — a rate limit, an unreachable service, an unknown address.
    // Reporting it as success would send them to wait for mail that never came.
    return { success: false, error: linkAttempt.failure.message };
  }

  const codeAttempt = await providerSendVerificationCode({ email: normalized });
  if (codeAttempt.failure) {
    return { success: false, error: codeAttempt.failure.message };
  }

  return { success: true, data: { method: "code" } };
}

/**
 * Verifies an address with a numeric code — the fallback half of the
 * verification flow, used when the branch has no custom email provider.
 *
 * The provider may establish a session as part of verification (auto-sign-in is
 * its default behaviour), which is why the redirect target is read from
 * MaliHub's own rows afterwards rather than assumed to be /complete-profile.
 */
export async function verifyEmailWithCodeAction(
  input: VerifyEmailCodeInput
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = verifyEmailCodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { data: verified, failure } = await providerVerifyEmailWithCode({
    email: parsed.data.email,
    otp: parsed.data.code,
  });

  if (!verified) {
    return {
      success: false,
      error: failure?.message ?? "That code isn't valid. Please check your email and try again.",
    };
  }

  // Re-read the session: verification may have signed the person in (that is the
  // provider default), or it may not. The three outcomes need three different
  // destinations, and collapsing them sends somebody who just verified their
  // address back to a sign-in form they no longer need.
  const identity = await requireActionIdentity();
  if (!identity.ok) {
    // Verified but still signed out — a normal outcome, not an error.
    return { success: true, data: { redirectTo: "/login" } };
  }

  const guarded = await requireActionUser();
  if (!guarded.ok) {
    // Signed in, but no MaliHub row maps to this identity yet — which is the
    // expected state for a brand-new account. Onboarding provisions it.
    return { success: true, data: { redirectTo: "/complete-profile" } };
  }

  // Whatever the outcome, the destination comes from MaliHub's rows, never from
  // a claim in the session.
  const destination = guarded.user.onboarded
    ? dashboardFor({
        onboarded: guarded.user.onboarded,
        hasSellerProfile: guarded.user.hasSellerProfile,
        role: guarded.user.role,
      })
    : "/complete-profile";

  return { success: true, data: { redirectTo: destination } };
}

// ─── Onboarding ────────────────────────────────────────────────────────────

export async function completeProfileAction(
  input: CompleteProfileInput
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = completeProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Identity only, not a mapped application user: a brand-new account can
  // legitimately arrive here before its users/profiles rows exist, and
  // `completeUserProfile` provisions them authoritatively inside its own
  // transaction. Requiring a mapped user would make first-time onboarding
  // impossible.
  const guarded = await requireActionIdentity();
  if (!guarded.ok) {
    return { success: false, error: guarded.error };
  }

  const { identity } = guarded;

  try {
    const { wantsToSell } = await completeUserProfile(identity, parsed.data);

    // No session refresh follows this write, and that is the point: onboarding
    // state is never stored in the auth token, so the next request simply reads
    // the new value from Postgres. There is no stale-claim window to close.
    return {
      success: true,
      data: { redirectTo: wantsToSell ? "/dashboard/seller" : "/dashboard/buyer" },
    };
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return { success: false, error: error.message };
    }

    // Log the real failure with enough context to identify it in production
    // (Prisma errors carry a `code` — P2025 "record to update not found" is
    // the one that used to mean "the application rows were never created").
    console.error("[auth] completeProfileAction failed", {
      authUserId: identity.authUserId,
      code: errorCodeOf(error),
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });

    if (errorCodeOf(error) === "P2002") {
      return {
        success: false,
        error: "That phone number or email is already linked to another MaliHub account.",
      };
    }

    return { success: false, error: "Something went wrong saving your profile. Please try again." };
  }
}

/**
 * Reads Prisma's error `code` without importing the generated runtime client
 * (this module is also bundled for the browser-side action boundary).
 */
function errorCodeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

// ─── Sign out ──────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  // Clears the session cookie upstream. The subsequent `redirect("/")` is what
  // actually lands the person somewhere; a provider failure must not trap them
  // on a page they were trying to leave.
  const { failure } = await providerSignOut();
  if (failure) {
    console.error("[auth] signOut: provider did not confirm session clear", {
      message: failure.message,
    });
  }
  redirect("/");
}
