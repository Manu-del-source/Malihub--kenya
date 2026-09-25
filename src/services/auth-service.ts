import "server-only";

import { prisma } from "@/lib/prisma";
import { shouldLinkUnmappedAccountsByEmail } from "@/lib/auth/config";
import { authIdentityFromProviderSession } from "@/lib/auth/identity";
import type { AuthIdentity } from "@/lib/auth/types";
import type { CompleteProfileInput } from "@/lib/validations/auth";
import {
  AuthServiceError,
  ensureUserProvisioned,
  getAuthoritativeOnboardingState,
  saveCompletedProfile,
  type AuthoritativeOnboardingState,
  type CompletedProfileRole,
} from "@/services/account-provisioning";

/**
 * Orchestration of the two writes that connect an authenticated Neon Auth
 * identity to MaliHub's application data.
 *
 * This module is the seam between "Neon Auth says you are X" and "MaliHub now
 * has rows for X". It owns no provider calls — those live in `src/lib/auth/neon.ts`
 * — and no authorization decisions; those live in `src/lib/auth/session.ts`.
 *
 * The Supabase-era version of this file also mirrored application state into the
 * provider's `app_metadata` and re-minted the browser JWT. That is gone: Neon
 * Auth has no claim store to mirror into, and authorization now reads the
 * database at the point of use. The retired implementation is preserved in
 * `src/lib/supabase/auth-legacy.ts`.
 */

export { AuthServiceError };
export { authIdentityFromProviderSession };
export type { AuthoritativeOnboardingState, CompletedProfileRole };

/**
 * Reads MaliHub's authoritative onboarding/role state for an application user.
 *
 * This is the successor to the old `syncSupabaseAppMetadata()`: the READ is
 * unchanged and still the single source of truth, but the provider-side WRITE
 * that mirrored it into a JWT claim is gone. Nothing caches this value, so
 * there is no stale-claim window and no session to re-mint after a change.
 *
 * Database failures propagate. A caller must never interpret "could not read"
 * as "not onboarded" — that is how an outage turns into everybody being
 * redirected to /complete-profile.
 */
export async function readOnboardingState(
  userId: string
): Promise<AuthoritativeOnboardingState> {
  return getAuthoritativeOnboardingState(prisma, userId);
}

/**
 * Best-effort provisioning for the points where a Neon Auth session is first
 * established: sign-up, sign-in, and the OAuth return.
 *
 * Authenticating a user does not by itself create their application rows — Neon
 * Auth writes only to its own `neon_auth` schema, which MaliHub must not touch.
 * Provisioning here means the rows exist before the user reaches any page that
 * reads them; /complete-profile provisions authoritatively inside its own
 * transaction regardless, so a failure here is recoverable.
 *
 * Failures are logged and returned, never thrown: sign-in follows this with an
 * authoritative read that fails closed on its own, and the caller decides
 * whether a provisioning problem is fatal for the operation it is performing.
 *
 * No credential, token, or cookie value is logged — only the provider's user id,
 * which is an opaque reference and not a secret.
 */
export async function provisionUserRows(
  session: AuthIdentity,
  context: "sign-up" | "sign-in" | "oauth return"
): Promise<{ userId: string | null; error: Error | null }> {
  try {
    const userId = await ensureUserProvisioned(
      prisma,
      authIdentityFromProviderSession(session),
      { linkUnmappedByEmail: shouldLinkUnmappedAccountsByEmail() }
    );
    return { userId, error: null };
  } catch (error) {
    console.error(`Failed to provision application rows on ${context}`, {
      authUserId: session.authUserId,
      // `AuthServiceError` carries user-facing copy and is not a defect;
      // anything else is logged with its class so production errors are
      // distinguishable from expected conflicts.
      kind: error instanceof AuthServiceError ? "expected" : error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
    return { userId: null, error: error as Error };
  }
}

/**
 * Runs everything that needs to happen once a user submits /complete-profile:
 *  1. resolve (provisioning if needed) their `users`/`profiles` rows inside the
 *     same transaction as the updates — this is what makes a first-ever save
 *     work and what removed the old `P2025` "record to update not found"
 *     failure on a freshly initialized database,
 *  2. claim their phone number and set the role,
 *  3. mark the profile onboarded,
 *  4. create a starter Seller row when they opted into selling.
 *
 * There is deliberately no post-commit provider synchronization step. The
 * previous implementation had one (`syncSupabaseAppMetadata` + a session
 * refresh) because middleware read onboarding from a JWT claim that lagged the
 * database; nothing reads a claim now, so the transaction committing IS the
 * state change taking effect. That also removes the redirect loop the refresh
 * existed to prevent.
 *
 * @returns the application user id, the resulting role, and whether a Seller row
 *          was requested — the caller uses `wantsToSell` to pick the dashboard.
 */
export async function completeUserProfile(
  session: AuthIdentity,
  input: CompleteProfileInput
): Promise<{ userId: string; role: CompletedProfileRole; wantsToSell: boolean }> {
  return saveCompletedProfile(prisma, authIdentityFromProviderSession(session), input, {
    linkUnmappedByEmail: shouldLinkUnmappedAccountsByEmail(),
  });
}
