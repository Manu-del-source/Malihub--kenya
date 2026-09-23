"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
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
  AuthServiceError,
} from "@/services/auth-service";
import type { ApiResult } from "@/types";

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  return process.env.NEXT_PUBLIC_APP_URL ?? `${protocol}://${host}`;
}

/** Registers a new account. Supabase sends the verification email itself
 * (default "Confirm email" setting) — this action just kicks that off. */
export async function signUpAction(input: RegisterInput): Promise<ApiResult<{ email: string }>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

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
    return { success: false, error: mapSupabaseError(error.message) };
  }
  if (!data.user) {
    return { success: false, error: "Something went wrong creating your account. Please try again." };
  }

  // Supabase owns the identity; the application rows live in Postgres and
  // have to be provisioned here (a fresh account has neither). Best-effort:
  // /complete-profile provisions the same rows authoritatively on submit.
  //
  // When the email is already registered Supabase returns an obfuscated user
  // with an empty `identities` array rather than an error — provisioning that
  // decoy id would create a stray row, so only real new identities count.
  if (data.user.identities?.length) {
    await provisionUserRows(data.user, "sign-up");
  }

  return { success: true, data: { email: parsed.data.email } };
}

export async function signInAction(
  input: LoginInput,
  redirectTo?: string
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { success: false, error: mapSupabaseError(error.message) };
  }

  // Self-heal accounts whose application rows predate (or were missed by)
  // provisioning — e.g. identities created before the app database moved to
  // its own Postgres. Best-effort: sign-in must still succeed without it.
  if (data.user) {
    await provisionUserRows(data.user, "sign-in");
  }

  // New/incomplete profiles go straight to onboarding regardless of where
  // they were headed; everyone else honors `redirectTo` (set by middleware
  // when it bounced them off a protected route) or falls back to their
  // buyer dashboard.
  const onboarded = data.user?.app_metadata?.onboarded === true;
  const destination = onboarded ? (redirectTo && redirectTo.startsWith("/") ? redirectTo : "/dashboard/buyer") : "/complete-profile";

  return { success: true, data: { redirectTo: destination } };
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
  input: ForgotPasswordInput
): Promise<ApiResult<{ email: string }>> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  // Supabase returns success even for unknown emails (prevents account
  // enumeration) — we surface the same message either way.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/api/auth/callback?next=/reset-password`,
  });

  return { success: true, data: { email: parsed.data.email } };
}

/** Called from /reset-password once the recovery session (established by
 * the emailed link, via /api/auth/callback) is active in the browser. */
export async function resetPasswordAction(
  input: ResetPasswordInput
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
    return { success: false, error: mapSupabaseError(error.message) };
  }

  return { success: true, data: { redirectTo: "/login" } };
}

export async function completeProfileAction(
  input: CompleteProfileInput
): Promise<ApiResult<{ redirectTo: string }>> {
  const parsed = completeProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const { wantsToSell } = await completeUserProfile(
      authIdentityFromSupabaseUser(user),
      parsed.data
    );
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
    console.error("completeProfileAction failed", {
      userId: user.id,
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

export async function resendVerificationAction(email: string): Promise<ApiResult<null>> {
  const supabase = await createClient();
  const origin = await getOrigin();

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/api/auth/callback?next=/complete-profile` },
  });

  if (error) {
    return { success: false, error: mapSupabaseError(error.message) };
  }
  return { success: true, data: null };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

/** Supabase's raw error messages are technically accurate but not the tone
 * we want in front of a user — this maps the common ones to friendlier copy. */
function mapSupabaseError(message: string): string {
  const known: Record<string, string> = {
    "Invalid login credentials": "That email or password doesn't look right.",
    "Email not confirmed": "Please verify your email before signing in — check your inbox.",
    "User already registered": "An account with that email already exists. Try signing in instead.",
    "Password should be at least 6 characters": "Choose a longer password (at least 8 characters).",
  };
  return known[message] ?? message;
}
