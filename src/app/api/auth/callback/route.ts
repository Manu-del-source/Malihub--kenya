import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalRedirect } from "@/lib/redirect-safety";
import {
  dashboardFor,
  settleAuthenticatedAccount,
} from "@/services/auth-service";
import {
  AuthError,
  classifySupabaseAuthError,
  classifyUnknownError,
} from "@/services/auth-errors";
import { AUTH_EVENTS, createAuthLog } from "@/services/auth-logging";

/**
 * Single callback for every Supabase redirect-based flow: Google OAuth,
 * "confirm your email" links, and "reset your password" links all point here
 * with a `code` param.
 *
 * The settlement pipeline (ensure Neon account → sync app_metadata claims →
 * refresh the user session) runs through the SAME `settleAuthenticatedAccount`
 * boundary password sign-in uses, so an OAuth user and a password user end up
 * in the identical canonical state. No provisioning logic is duplicated here.
 *
 * The `next` param is user-influenced, so it is only honored when
 * `safeInternalRedirect()` accepts it — external targets are a controlled,
 * logged fall-through to the state-based destination.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Missing verification code.")}`,
    );
  }

  const log = createAuthLog("auth-callback");
  log.start();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    const classified = error
      ? classifySupabaseAuthError(error, "oauth-exchange")
      : new AuthError("INTERNAL_ERROR", "Code exchange returned no user.", {
          boundary: "supabase-auth",
          detail: { note: "exchangeCodeForSession returned no user" },
        });
    log.failure(classified);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That link has expired or was already used.")}`,
    );
  }

  try {
    const state = await settleAuthenticatedAccount({
      supabaseUser: data.user,
      sessionClient: supabase,
      context: "auth-callback",
      log,
    });

    // Honor a safe internal `next` if given (e.g. the login page's
    // `redirectTo`), otherwise route from canonical Neon state. Middleware
    // remains the final authority and will correct any mismatch.
    const destination =
      safeInternalRedirect(requestedNext) ??
      (state.onboarded ? dashboardFor(state) : "/complete-profile");

    log.success(AUTH_EVENTS.REDIRECT, { destination });
    return NextResponse.redirect(`${origin}${destination}`);
  } catch (error) {
    // The session WAS established by the code exchange, but the application
    // state could not be verified (Neon down / Admin mirror down). Controlled
    // failure: keep the session and route to /complete-profile — it is
    // onboarding-exempt and self-heals (re-reads Neon and re-syncs claims on
    // each visit), so there is no redirect loop and no forced re-login.
    const classified = error instanceof AuthError ? error : classifyUnknownError(error);
    log.failure(classified, { userId: data.user.id });
    return NextResponse.redirect(`${origin}/complete-profile`);
  }
}
