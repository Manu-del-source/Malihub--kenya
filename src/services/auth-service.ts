import "server-only";
import { prisma } from "@/lib/prisma";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CompleteProfileInput } from "@/lib/validations/auth";
import {
  AuthServiceError,
  authIdentityFromSupabaseUser,
  ensureUserProvisioned,
  saveCompletedProfile,
  type AuthIdentity,
  type SupabaseIdentityUser,
} from "@/services/account-provisioning";

// Re-exported so callers keep importing user-facing auth errors / the identity
// mapper from the auth service (the canonical home of auth plumbing).
export { AuthServiceError, authIdentityFromSupabaseUser };
export type { AuthIdentity };

/**
 * Runs everything that needs to happen once a user submits /complete-profile:
 *  1. Provision their `users`/`profiles` rows if they don't exist yet, then
 *     claim their phone number and finish the profile (onboarded = true).
 *  2. If they opted into selling, create a starter Seller row.
 *  3. Mirror the resulting role into the Supabase JWT's app_metadata, so
 *     middleware can read it at the edge without a DB round trip on every
 *     request (see ARCHITECTURE.md §5).
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

  // Best-effort: if this fails, middleware's fallback DB check (see
  // src/middleware.ts) still catches it on the next request — the JWT
  // claim is a fast path, not the source of truth.
  try {
    const supabase = createServiceRoleClient();
    await supabase.auth.admin.updateUserById(identity.id, {
      app_metadata: { role, has_seller_profile: wantsToSell, onboarded: true },
    });
  } catch (error) {
    console.error("Failed to sync role into Supabase app_metadata", {
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
 * Failures are logged, never thrown: a mirror-row hiccup must not turn a
 * successful sign-in into an error, and the onboarding write retries this same
 * idempotent upsert.
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
