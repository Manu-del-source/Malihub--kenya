import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { RetryButton } from "@/components/auth/retry-button";
import { CompleteProfileForm } from "@/components/auth/complete-profile-form";
import { createClient } from "@/lib/supabase/server";
import {
  dashboardFor,
  getApplicationAccountState,
  refreshUserSession,
  syncApplicationClaims,
} from "@/services/auth-service";
import { AuthError, classifyPrismaError, userFacingMessage } from "@/services/auth-errors";
import { AUTH_EVENTS, createAuthLog } from "@/services/auth-logging";

export const metadata: Metadata = {
  title: "Complete your profile",
};

/**
 * The onboarding page — and the deterministic loop breaker.
 *
 * The middleware sends every authenticated user whose (live) Supabase
 * app_metadata lacks `onboarded: true` here. This page then decides from
 * NEON, the source of truth, what that user actually is:
 *
 *   not signed in           → /login
 *   Neon unreachable        → error card (controlled failure — NO redirect, so
 *                             a database outage can never become a loop)
 *   not onboarded in Neon   → the form (submission provisions + completes in
 *                             one transaction)
 *   onboarded, claims OK    → the dashboard
 *   onboarded, claims stale → self-heal: re-sync claims + refresh the session
 *                             exactly once, then the dashboard; if the sync
 *                             fails → the error card (a stable state, never a
 *                             redirect cycle)
 *
 * Every request to this page converges on one of those states — there is no
 * path that redirects back to itself, so an older JWT or a failed metadata
 * sync can no longer produce a /complete-profile ↔ /dashboard loop.
 */
export default async function CompleteProfilePage() {
  const log = createAuthLog("complete-profile-page");
  log.start();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirectTo=/complete-profile");
  }
  log.success(AUTH_EVENTS.SUPABASE_SUCCESS, { userId: user.id });

  // Authoritative Neon state. A database failure is a controlled failure:
  // render a retryable card — never redirect (a loop) and never guess
  // onboarding state.
  let lookup;
  try {
    lookup = await getApplicationAccountState(user.id, log);
  } catch (error) {
    const classified =
      error instanceof AuthError ? error : classifyPrismaError(error, "ACCOUNT_LOOKUP_FAILED");
    log.failure(classified, { userId: user.id });
    return <AccountUnavailableCard message={userFacingMessage(classified)} />;
  }
  const state = lookup.state;
  log.success(AUTH_EVENTS.ACCOUNT_LOOKUP_SUCCESS, {
    status: lookup.status,
    onboarded: state.onboarded,
    role: state.role,
  });

  if (!state.onboarded) {
    // Genuinely incomplete (or not yet provisioned — the form submission
    // provisions inside its transaction). Nothing to heal.
    const metadata = user.user_metadata ?? {};
    const defaultFullName =
      state.profile?.fullName ||
      (typeof metadata.full_name === "string" ? metadata.full_name : "") ||
      (typeof metadata.name === "string" ? metadata.name : "");
    const defaultAvatarUrl =
      state.profile?.avatarUrl ??
      (typeof metadata.avatar_url === "string" ? metadata.avatar_url : "") ??
      "";

    return (
      <AuthCard
        title="Complete your profile"
        subtitle="A few quick details so buyers and sellers know who they're dealing with."
      >
        <CompleteProfileForm
          userId={user.id}
          defaultFullName={defaultFullName}
          defaultAvatarUrl={defaultAvatarUrl}
        />
      </AuthCard>
    );
  }

  // Neon says onboarded. Check the Supabase-side claims the middleware reads.
  const meta = user.app_metadata ?? {};
  const claimsConsistent =
    meta.onboarded === true &&
    meta.role === state.role &&
    meta.has_seller_profile === state.hasSellerProfile;

  if (claimsConsistent) {
    const destination = dashboardFor(state);
    log.success(AUTH_EVENTS.REDIRECT, { destination });
    redirect(destination);
  }

  // Stale claims (an older JWT, or a metadata sync that failed earlier).
  // Self-heal exactly once: re-sync from Neon, refresh the session, redirect.
  let healed = false;
  try {
    await syncApplicationClaims(user.id, state, log);
    healed = true;
  } catch (error) {
    if (error instanceof AuthError) {
      log.failure(error, { step: "claim-repair" });
    }
  }

  if (healed) {
    await refreshUserSession(supabase, user.id, log);
    const destination = dashboardFor(state);
    log.success(AUTH_EVENTS.REDIRECT, { destination, healed: true });
    redirect(destination);
  }

  // The claims could not be repaired right now (Supabase Admin unavailable).
  // Stable error state — no redirect, no loop. The next visit retries.
  return (
    <AccountUnavailableCard message="We couldn't sync your MaliHub account yet. Please try again in a moment." />
  );
}

/**
 * Controlled-failure card for this page. Renders content (never redirects),
 * which is what makes a database or Admin outage a stable state instead of a
 * redirect loop.
 */
function AccountUnavailableCard({ message }: { message: string }) {
  return (
    <AuthCard title="Almost there" subtitle={message}>
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Your sign-in worked — this is a temporary problem loading your
          account details. No data was changed.
        </p>
        <RetryButton />
        <p className="text-center text-xs text-muted-foreground">
          If this keeps happening,{" "}
          <Link href="/login" className="text-primary-400 hover:underline">
            sign in again
          </Link>
          .
        </p>
      </div>
    </AuthCard>
  );
}
