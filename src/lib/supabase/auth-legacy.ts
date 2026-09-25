import "server-only";

import { prisma } from "@/lib/prisma";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CompleteProfileInput } from "@/lib/validations/auth";
import { AuthServiceError } from "@/services/account-provisioning";
import { slugify } from "@/utils";

/**
 * ─── RETAINED FOR ROLLBACK. NOT PART OF THE ACTIVE AUTHENTICATION PATH. ────
 *
 * This is the Supabase Auth implementation that MaliHub ran before Neon Auth
 * became the primary identity provider. **Nothing imports it.** It is kept in
 * the tree so that a production rollback does not depend on archaeology in git
 * history, and so the diff between the two systems stays reviewable side by
 * side.
 *
 * Restoring it is documented in docs/auth/MIGRATION.md §8. The short version:
 * this module alone is NOT sufficient to roll back — the Server Actions, the
 * middleware and the ~25 call sites that now use `@/lib/auth` also have to move
 * back, which is why the documented rollback path is
 *
 *     git checkout <pre-migration-commit> -- src/app/\(auth\)/actions.ts \
 *       src/middleware.ts src/services/auth-service.ts src/lib/auth
 *
 * with this file as the reference for what the Supabase side did.
 *
 * ─── Why it is not simply deleted ──────────────────────────────────────────
 * Supabase itself is NOT being removed from MaliHub. It stays installed and
 * configured, and two non-authentication features still depend on it in the
 * live request path:
 *
 *   - profile avatar uploads  → `src/components/auth/avatar-upload.tsx`
 *                               (Supabase Storage, `avatars` bucket)
 *   - chat realtime           → `src/hooks/use-chat-realtime.ts`
 *                               (Supabase Realtime, postgres_changes + presence)
 *
 * What is retired is Supabase **Auth** specifically: session issuing, password
 * verification, OAuth, email verification, password reset, and the
 * `app_metadata` claim cache. Those must not run alongside Neon Auth, because
 * two providers both able to establish a session is two authentication systems.
 *
 * ─── The app_metadata architecture this replaces ───────────────────────────
 * The functions below mirrored MaliHub's authoritative role/onboarding state
 * into Supabase's `app_metadata` so middleware could read it from a JWT claim
 * without a database query, then re-minted the browser JWT with
 * `refreshSession()`. That design produced two classes of production bug: a
 * stale claim bouncing a fully onboarded user back to /complete-profile in a
 * loop, and a metadata-sync failure that had to be handled by force-clearing a
 * valid session. Neon Auth offers no equivalent claim store and accepts no
 * custom plugins, so the replacement reads authoritative state at the point of
 * use instead of caching it into a token. Do not reintroduce it.
 */

// ─── Identity mapping (superseded by src/lib/auth/identity.ts) ─────────────

/**
 * The identity shape the Supabase flow used. Note `id` here is the Supabase
 * auth UUID and was written directly into `users.id` — the coupling that made a
 * provider change look expensive. The Neon Auth implementation keeps
 * `users.id` as a MaliHub-generated UUID and maps the provider's id onto
 * `users.auth_user_id` instead.
 */
export type SupabaseAuthIdentity = {
  id: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  fullName: string;
  avatarUrl: string | null;
};

/** Structural subset of Supabase's `User`, so this module needs no SDK types. */
export type SupabaseIdentityUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Builds the identity record from a Supabase user. Mirrored what the old
 * database trigger read from `raw_user_meta_data`: `full_name`, then `name`
 * (Google OAuth), then an empty string.
 */
export function authIdentityFromSupabaseUser(user: SupabaseIdentityUser): SupabaseAuthIdentity {
  const metadata = user.user_metadata ?? {};

  return {
    id: user.id,
    email: user.email?.trim() ?? "",
    phone: user.phone?.trim() ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    fullName: metadataString(metadata, "full_name") ?? metadataString(metadata, "name") ?? "",
    avatarUrl: metadataString(metadata, "avatar_url"),
  };
}

// ─── Provisioning (superseded by ensureUserProvisioned) ────────────────────

/**
 * The Supabase-era provisioning write: `users.id` IS the provider id.
 *
 * Kept separate from the active provisioner because the two are genuinely
 * different operations — this one supplies an external id as the primary key,
 * the active one generates MaliHub's own and stores the external id in
 * `auth_user_id`. Restoring this is what a rollback needs; leaving it in the
 * active module would invite the two to be conflated.
 */
export async function supabaseEnsureUserProvisioned(
  identity: SupabaseAuthIdentity
): Promise<void> {
  if (!identity.email) {
    throw new AuthServiceError(
      "Your MaliHub account has no email address on file. Please contact support."
    );
  }

  await prisma.user.upsert({
    where: { id: identity.id },
    create: {
      id: identity.id,
      // A row provisioned by the legacy path has no Neon Auth identity.
      authUserId: null,
      email: identity.email,
      phone: identity.phone,
      emailVerified: identity.emailVerified,
    },
    // `undefined` means "leave as-is": provisioning may confirm an address but
    // must never un-confirm one, and never touches phone or role.
    update: {
      email: identity.email,
      emailVerified: identity.emailVerified || undefined,
    },
  });

  await prisma.profile.upsert({
    where: { userId: identity.id },
    create: {
      userId: identity.id,
      fullName: identity.fullName,
      avatarUrl: identity.avatarUrl,
    },
    update: {},
  });
}

/**
 * Best-effort provisioning at the points where a Supabase session was
 * established (sign-up, sign-in, OAuth / email-confirmation callback).
 * Failures were logged, never thrown.
 */
export async function supabaseProvisionUserRows(
  user: SupabaseIdentityUser,
  context: "sign-up" | "sign-in" | "auth callback"
): Promise<void> {
  try {
    await supabaseEnsureUserProvisioned(authIdentityFromSupabaseUser(user));
  } catch (error) {
    console.error(`[legacy-supabase-auth] failed to provision rows on ${context}`, {
      userId: user.id,
      error,
    });
  }
}

// ─── app_metadata mirroring (deliberately NOT reproduced on Neon Auth) ─────

export type LegacyOnboardingState = {
  onboarded: boolean;
  role: string;
  hasSellerProfile: boolean;
};

/**
 * Wrote MaliHub's authoritative state into Supabase `app_metadata` using the
 * service-role key, so middleware could read role/onboarding from a JWT claim.
 *
 * Callers then had to call `supabase.auth.refreshSession()` on the user's own
 * cookie-backed client, because the Admin API change does not re-mint the JWT
 * already sitting in the browser. That two-step (privileged write + session
 * refresh) is precisely the coupling the current architecture removed.
 */
export async function syncSupabaseAppMetadata(
  userId: string
): Promise<LegacyOnboardingState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      profile: { select: { onboarded: true } },
      seller: { select: { id: true } },
    },
  });

  const state: LegacyOnboardingState = {
    onboarded: user?.profile?.onboarded === true,
    role: user?.role ?? "BUYER",
    hasSellerProfile: Boolean(user?.seller),
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      role: state.role,
      has_seller_profile: state.hasSellerProfile,
      onboarded: state.onboarded,
    },
  });

  if (error) throw error;

  return state;
}

/**
 * The /complete-profile write as the Supabase flow performed it: commit the
 * Neon transaction, then mirror the result into `app_metadata` best-effort.
 *
 * The active implementation keeps the transaction (unchanged, in
 * `saveCompletedProfile`) and drops the mirroring entirely — there is no claim
 * cache to keep in sync.
 */
export async function supabaseCompleteUserProfile(
  identity: SupabaseAuthIdentity,
  input: CompleteProfileInput
): Promise<{ role: "BUYER" | "SELLER"; wantsToSell: boolean }> {
  const wantsToSell = input.accountIntent === "SELLER" || input.accountIntent === "BOTH";
  const role: "BUYER" | "SELLER" = wantsToSell ? "SELLER" : "BUYER";

  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: identity.id },
      create: {
        id: identity.id,
        authUserId: null,
        email: identity.email,
        phone: identity.phone,
        emailVerified: identity.emailVerified,
      },
      update: {},
    });

    await tx.profile.upsert({
      where: { userId: identity.id },
      create: { userId: identity.id, fullName: identity.fullName },
      update: {},
    });

    const existingPhone = await tx.user.findFirst({
      where: { phone: input.phone, NOT: { id: identity.id } },
      select: { id: true },
    });
    if (existingPhone) {
      throw new AuthServiceError(
        "That phone number is already linked to another MaliHub account."
      );
    }

    await tx.user.update({
      where: { id: identity.id },
      data: { phone: input.phone, role },
    });

    await tx.profile.update({
      where: { userId: identity.id },
      data: {
        fullName: input.fullName,
        county: input.county,
        avatarUrl: input.avatarUrl || null,
        onboarded: true,
      },
    });

    if (wantsToSell) {
      const existingSeller = await tx.seller.findUnique({ where: { userId: identity.id } });
      if (!existingSeller) {
        await tx.seller.create({
          data: {
            userId: identity.id,
            businessName: input.fullName,
            slug: slugify(input.fullName),
            county: input.county,
          },
        });
      }
    }
  });

  try {
    await syncSupabaseAppMetadata(identity.id);
  } catch (error) {
    console.error("[legacy-supabase-auth] failed to sync app_metadata", {
      userId: identity.id,
      error,
    });
  }

  return { role, wantsToSell };
}

/**
 * The previous provider's raw error messages mapped to user-facing copy,
 * preserved so a rollback restores the exact strings users saw. The Neon Auth
 * equivalent lives in `src/lib/auth/errors.ts`.
 */
export function mapSupabaseError(message: string): string {
  const known: Record<string, string> = {
    "Invalid login credentials": "That email or password doesn't look right.",
    "Email not confirmed": "Please verify your email before signing in — check your inbox.",
    "User already registered": "An account with that email already exists. Try signing in instead.",
    "Password should be at least 6 characters": "Choose a longer password (at least 8 characters).",
  };
  return known[message] ?? message;
}
