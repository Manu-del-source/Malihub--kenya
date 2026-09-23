import "server-only";
import { prisma } from "@/lib/prisma";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CompleteProfileInput } from "@/lib/validations/auth";
import {
  AuthServiceError,
  authIdentityFromSupabaseUser,
  ensureUserProvisioned,
  getAuthoritativeOnboardingState,
  saveCompletedProfile,
  type AuthIdentity,
  type AuthoritativeOnboardingState,
  type SupabaseIdentityUser,
} from "@/services/account-provisioning";

// Re-exported so callers keep importing user-facing auth errors / the identity
// mapper from the auth service (the canonical home of auth plumbing).
export { AuthServiceError, authIdentityFromSupabaseUser };
export type { AuthIdentity, AuthoritativeOnboardingState };

/**
 * Repairs the JWT/session cache from Neon, the source of truth for
 * application onboarding and roles. The service-role client is used only for
 * the privileged metadata write; callers must refresh the user's session on
 * their own per-request client after this succeeds.
 *
 * Missing application rows are mirrored conservatively as an incomplete
 * BUYER account. Database and Supabase Admin API failures propagate so callers
 * can fail closed instead of treating authentication as proof of onboarding.
 */
export async function syncSupabaseAppMetadata(
  userId: string
): Promise<AuthoritativeOnboardingState> {
  const state = await getAuthoritativeOnboardingState(prisma, userId);
  const supabase = createServiceRoleClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      role: state.role,
      has_seller_profile: state.hasSellerProfile,
      onboarded: state.onboarded,
    },
  });

  if (error) {
    throw error;
  }

  return state;
}

/**
 * Runs everything that needs to happen once a user submits /complete-profile:
 *  1. Provision their `users`/`profiles` rows if they don't exist yet, then
 *     claim their phone number and finish the profile (onboarded = true).
 *  2. If they opted into selling, create a starter Seller row.
 *  3. Re-read the committed Neon state and mirror it into Supabase
 *     app_metadata, so middleware can read it at the edge without a DB round
 *     trip on every request (see ARCHITECTURE.md §5).
 *
 * Step 1 happens inside the same transaction as the updates, so the
 * "record to update not found" (`P2025`) failure a freshly initialized
 * database used to produce is impossible: the row is created in the same
 * transaction that updates it. The JWT sync happens after commit since it's a
 * separate system (Supabase Auth) that can't participate in the Postgres
 * transaction.
 */
export async function completeUserProfile(identity: AuthIdentity, input: CompleteProfileInput) {
  const { role, wantsToSell } = await saveCompletedProfile(prisma, identity, input);

  // Keep metadata synchronization best-effort here because the authoritative
  // Neon transaction has already committed and cannot be rolled back if the
  // separate Supabase Admin API is temporarily unavailable. The action still
  // refreshes the user-facing session exactly once after this attempt.
  try {
    await syncSupabaseAppMetadata(identity.id);
  } catch (error) {
    console.error("Failed to sync onboarding state into Supabase app_metadata", {
      userId: identity.id,
      error,
    });
  }

  return { role, wantsToSell };
}

/**
 * Best-effort provisioning for the points where a Supabase session is
 * established (sign-up, sign-in, OAuth / email-confirmation callback).
 *
 * Supabase authenticating a user does not, by itself, create their
 * application rows — Supabase's database trigger can't fire on an independent
 * Postgres (see src/services/account-provisioning.ts). Provisioning here means
 * rows exist before the user reaches any page that reads them; /complete-profile
 * provisions authoritatively inside its transaction regardless.
 *
 * Failures are logged, never thrown from this best-effort provisioner. Sign-in
 * follows it with a separate authoritative lookup (and fails closed if Neon is
 * unavailable); the onboarding write retries the same idempotent upsert.
 */
export async function provisionUserRows(
  user: SupabaseIdentityUser,
  context: "sign-up" | "sign-in" | "auth callback"
): Promise<void> {
  try {
    await ensureUserProvisioned(prisma, authIdentityFromSupabaseUser(user));
  } catch (error) {
    console.error(`Failed to provision application rows on ${context}`, {
      userId: user.id,
      error,
    });
  }
}
