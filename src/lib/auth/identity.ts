import "server-only";

import { prisma } from "@/lib/prisma";
import { shouldLinkUnmappedAccountsByEmail } from "@/lib/auth/config";
import {
  AuthServiceError,
  ensureUserProvisioned,
  findMappedApplicationUserId,
  readApplicationAccess,
  type ApplicationAccessRecord,
  type ProvisioningIdentity,
} from "@/services/account-provisioning";
import type { AuthIdentity as ProviderIdentity } from "@/lib/auth/types";

/**
 * The mapping between a Neon Auth identity and a MaliHub application user.
 *
 * This is the module that answers "the auth service says you are X — which
 * MaliHub account is that?". It is the only place in the application that knows
 * both ids exist, and it is deliberately thin: the real work (row provisioning,
 * the email-collision rule, the legacy-claim gate) lives in the provider-agnostic
 * `src/services/account-provisioning.ts`, which is unit-testable against a fake
 * store.
 *
 * ─── Direction of the mapping ──────────────────────────────────────────────
 * Neon Auth identity (`authUserId`) ──▶ MaliHub user (`users.id`)
 *
 * It is one-directional and resolved through the UNIQUE `users.auth_user_id`
 * column. MaliHub never asks the auth service to look an account up by
 * application id, and the auth service never learns what a MaliHub application
 * id is.
 */

export { AuthServiceError };
export type { ProvisioningIdentity };

/**
 * Converts a provider session into the identity record the application rows
 * need.
 *
 * Field mapping (verified against what Managed Better Auth actually returns,
 * which differs from the previous provider's `user_metadata` shape):
 *
 *   provider `user.id`            → `authUserId`   (the mapping key)
 *   provider `user.email`         → `email`
 *   provider `user.name`          → `fullName`     (was `user_metadata.full_name`)
 *   provider `user.image`         → `avatarUrl`    (was `user_metadata.avatar_url`)
 *   provider `user.emailVerified` → `emailVerified` (a boolean flag, not a timestamp)
 *
 * `phone` is always null here: MaliHub collects the phone number at
 * /complete-profile, not at sign-up, and Neon Auth accounts carry no phone.
 */
export function authIdentityFromProviderSession(session: ProviderIdentity): ProvisioningIdentity {
  return {
    authUserId: session.authUserId,
    email: session.email,
    phone: null,
    emailVerified: session.emailVerified,
    fullName: session.name ?? "",
    avatarUrl: session.image,
  };
}

/**
 * Resolves the MaliHub application user for an authenticated provider session,
 * provisioning the rows when this identity is new.
 *
 * Called at every point a session is established (sign-up, sign-in, the OAuth
 * return) and again inside the /complete-profile transaction. Idempotent.
 *
 * Failures are returned, not thrown, so each caller can decide whether a
 * provisioning problem is fatal (sign-in: fail closed) or merely best-effort
 * (sign-up: /complete-profile will retry the same write authoritatively).
 */
export async function provisionApplicationUser(
  session: ProviderIdentity
): Promise<{ userId: string | null; error: AuthServiceError | Error | null }> {
  try {
    const userId = await ensureUserProvisioned(
      prisma,
      authIdentityFromProviderSession(session),
      { linkUnmappedByEmail: shouldLinkUnmappedAccountsByEmail() }
    );
    return { userId, error: null };
  } catch (error) {
    return { userId: null, error: error as Error };
  }
}

/**
 * Reads the authoritative application state for a provider session WITHOUT
 * provisioning anything.
 *
 * Read-only on purpose. This backs every guard, and guards run on essentially
 * every request — a public marketing page included. Provisioning here would put
 * two writes on the hottest path in the app to answer a question whose usual
 * answer is "no rows yet". Writes stay where an identity is established:
 * sign-up, sign-in, and the /complete-profile transaction.
 *
 * Returns `null` when the identity is authenticated but no MaliHub row maps to
 * it — the case guards must handle explicitly rather than treating as "not
 * onboarded", because the right response is a repair (or a support message),
 * not a silent privilege grant.
 *
 * Database errors propagate: an unavailable application database must never be
 * read as "this user has no privileges" or, worse, as "this user is fine".
 */
export async function readAccessForSession(
  session: ProviderIdentity
): Promise<ApplicationAccessRecord | null> {
  const userId = await findMappedApplicationUserId(prisma, session.authUserId);
  if (!userId) return null;
  return readApplicationAccess(prisma, userId);
}
