"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeInternalRedirect } from "@/lib/redirect-safety";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  completeProfileSchema,
  type RegisterInput,
  type LoginInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type CompleteProfileInput,
} from "@/lib/validations/auth";
import {
  completeUserProfile,
  authIdentityFromSupabaseUser,
  provisionUserRows,
  refreshUserSession,
  settleAuthenticatedAccount,
  dashboardFor,
  AuthServiceError,
} from "@/services/auth-service";
import {
  AuthError,
  classifyPrismaError,
  classifySupabaseAuthError,
  classifyUnknownError,
  userFacingMessage,
} from "@/services/auth-errors";
import { AUTH_EVENTS, createAuthLog } from "@/services/auth-logging";
import type { ApiResult } from "@/types";

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  return process.env.NEXT_PUBLIC_APP_URL ?? `${protocol}://${host}`;
}

/**
 * Maps a raw Supabase error to its classified form AND its user-facing copy.
 * The raw error is logged (with the real cause) by the caller; only the safe
 * copy reaches the UI.
 */
function authFailure(
  error: unknown,
  operation: "sign-in" | "sign-up" | "password-reset" | "oauth-exchange",
) {
  const classified =
    error instanceof AuthError ? error : classifySupabaseAuthError(error, operation);
  return { classified, message: userFacingMessage(classified) };
}

/** Registers a new account. Supabase sends the verification email itself
 * (default "Confirm email" setting) — this action just kicks that off. */
export async function signUpAction(input: RegisterInput): Promise<ApiResult<{ email: string }>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const log = createAuthLog("sign-up");
  log.start({ email: parsed.data.email });

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/api/auth/callback?next=/complete-profile`,
    },
  });

  if (error) {
    const { classified, message } = authFailure(error, "sign-up");
    log.failure(classified, { email: parsed.data.email });
    return { success: false, error: message };
  }
  if (!data.user) {
    const classified = new AuthError("INTERNAL_ERROR", "Sign-up returned no user.", {
      boundary: "supabase-auth",
      detail: { note: "signUp returned no user" },
    });
    log.failure(classified);
    return { success: false, error: "Something went wrong creating your account. Please try again." };
  }

  // Supabase owns the identity; the application rows live in Postgres. A fresh
  // account has neither, so we provision best-effort here. /complete-profile
  // and the next sign-in provision the same rows authoritatively (idempotent),
  // so a failure here is not fatal — it is classified and logged.
  //
  // When the email is already registered Supabase returns an obfuscated user
  // with an empty `identities` array rather than an error — provisioning that
  // decoy id would create a stray row, so only real new identities count.
  if (data.user.identities?.length) {
    await provisionUserRows(data.user, "sign-up");
  }

  return { success: true, data: { email: parsed.data.email } };
}

/**
 * Email + password sign-in. The flow is intentionally a straight line:
 *
 *   authenticate (Supabase)
 *     → settleAuthenticatedAccount
 *         (ensure Neon account → sync claims → refresh session)
 *     → compute a safe destination from the CANONICAL Neon state
 *     → return success
 *
 * Routing decisions come ONLY from the authoritative Neon state — never from
 * the pre-refresh Supabase payload or stale app_metadata. On any failure after
 * authentication we fail closed: the session is cleared and a classified,
 * controlled error is returned (the real cause is in the server log).
 */
export async function signInAction(
  input: LoginInput,
  redirectTo?: string,
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const log = createAuthLog("sign-in");
  log.start({ email: parsed.data.email });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const { classified, message } = authFailure(error, "sign-in");
    log.failure(classified, { email: parsed.data.email });
    return { success: false, error: message };
  }

  if (!data.user) {
    const classified = new AuthError("INTERNAL_ERROR", "Sign-in returned no user.", {
      boundary: "supabase-auth",
      detail: { note: "signInWithPassword returned no user" },
    });
    log.failure(classified);
    return { success: false, error: "Something went wrong signing you in. Please try again." };
  }

  try {
    const state = await settleAuthenticatedAccount({
      supabaseUser: data.user,
      sessionClient: supabase,
      context: "sign-in",
      log,
    });

    // Neon, not the pre-refresh Supabase payload, decides whether the user
    // completed onboarding.
    const destination = state.onboarded
      ? safeInternalRedirect(redirectTo) ?? dashboardFor(state)
      : "/complete-profile";

    log.success(AUTH_EVENTS.REDIRECT, { destination });
    return { success: true, data: { redirectTo: destination } };
  } catch (error) {
    // Authentication succeeded, but the application could not establish
    // consistent state (Neon down, or Supabase Admin could not mirror the
    // claims). Fail closed: clear the session so we never carry a session
    // with unverified/stale claims, and return a controlled, classified error.
    const classified = error instanceof AuthError ? error : classifyUnknownError(error);
    log.failure(classified, { userId: data.user.id });

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        log.failure(classifyUnknownError(signOutError), { step: "sign-out" });
      }
    } catch (signOutError) {
      log.failure(classifyUnknownError(signOutError), { step: "sign-out" });
    }

    return { success: false, error: userFacingMessage(classified) };
  }
}

/** Kicks off Google OAuth — the browser is redirected to Google, then back
 * to /api/auth/callback, which exchanges the code for a session. */
export async function signInWithGoogleAction(next: string = "/complete-profile") {
  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent("Couldn't start Google sign-in. Please try again.")}`);
  }

  redirect(data.url);
}

export async function forgotPasswordAction(
  input: ForgotPasswordInput,
): Promise<ApiResult<{ email: string }>> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  // Supabase returns success even for unknown emails (prevents account
  // enumeration) — we surface the same message either way, but we DO log a
  // real transport/auth failure server-side so an outage is diagnosable.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/api/auth/callback?next=/reset-password`,
  });
  if (error) {
    const { classified } = authFailure(error, "password-reset");
    const log = createAuthLog("forgot-password");
    log.failure(classified, { email: parsed.data.email });
  }

  return { success: true, data: { email: parsed.data.email } };
}

/** Called from /reset-password once the recovery session (established by
 * the emailed link, via /api/auth/callback) is active in the browser. */
export async function resetPasswordAction(
  input: ResetPasswordInput,
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "Your password reset link has expired. Please request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const { classified, message } = authFailure(error, "password-reset");
    const log = createAuthLog("reset-password");
    log.failure(classified, { userId: user.id });
    return { success: false, error: message };
  }

  return { success: true, data: { redirectTo: "/login" } };
}

/**
 * /complete-profile submit. The flow is:
 *
 *   authenticated user
 *     → validate input
 *     → completeUserProfile (Neon transaction commits FIRST, then best-effort
 *       metadata sync)
 *     → refresh the user session exactly once
 *     → route from the CANONICAL committed state
 *
 * No JWT/session update happens before the Neon transaction commits, and the
 * destination is computed from Neon truth (not `wantsToSell` alone), so an
 * existing Seller who re-runs onboarding still lands on the seller dashboard.
 */
export async function completeProfileAction(
  input: CompleteProfileInput,
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = completeProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const log = createAuthLog("profile-completion");
  log.start();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const classified = new AuthError("AUTHENTICATION_FAILED", "No active session.", {
      boundary: "supabase-auth",
      detail: { reason: "no-session", step: "profile-completion" },
    });
    log.failure(classified);
    return { success: false, error: "Your session has expired. Please sign in again." };
  }
  log.success(AUTH_EVENTS.SUPABASE_SUCCESS, { userId: user.id });

  const identity = authIdentityFromSupabaseUser(user);

  try {
    const { state } = await completeUserProfile(identity, parsed.data, log);

    // The Neon transaction committed and (best-effort) app_metadata was
    // synced on the server. Refresh the user-facing session exactly once so
    // the browser's cookie carries the new `onboarded: true` claim before we
    // redirect to the dashboard.
    const sessionRefreshed = await refreshUserSession(supabase, user.id, log);

    // Route from canonical Neon state (Seller row decides the seller
    // dashboard), never from the request payload.
    const destination = dashboardFor(state);
    log.success(AUTH_EVENTS.REDIRECT, { destination, sessionRefreshed });

    return { success: true, data: { redirectTo: destination } };
  } catch (error) {
    if (error instanceof AuthServiceError) {
      // User-accountable (phone already claimed, no email on file).
      const classified = new AuthError("ACCOUNT_PROVISIONING_FAILED", error.message, {
        boundary: "neon",
        detail: { note: error.message },
        userMessage: error.message,
      });
      log.failure(classified, { userId: user.id });
      return { success: false, error: error.message };
    }

    // A database-level write failure. Classify (P2002 is the phone/email
    // uniqueness race the service pre-check makes rare) and return a safe
    // message; the real cause is logged.
    const classified =
      error instanceof AuthError
        ? error
        : classifyPrismaError(error, "ACCOUNT_PROVISIONING_FAILED");
    log.failure(classified, { userId: user.id });

    if (classified.detail.prismaCode === "P2002") {
      return {
        success: false,
        error: "That phone number or email is already linked to another MaliHub account.",
      };
    }

    return { success: false, error: userFacingMessage(classified) };
  }
}

export async function resendVerificationAction(email: string): Promise<ApiResult<null>> {
  const supabase = await createClient();
  const origin = await getOrigin();

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/api/auth/callback?next=/complete-profile` },
  });

  if (error) {
    const { message } = authFailure(error, "sign-up");
    return { success: false, error: message };
  }
  return { success: true, data: null };
}

export async function signOutAction() {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // Even if the server-side invalidation fails, the cookie is cleared and
    // the user is redirected — sign-out must not throw a 500.
  }
  redirect("/");
}
