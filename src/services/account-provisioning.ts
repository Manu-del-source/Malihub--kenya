import type { Prisma, PrismaClient } from "@prisma/client";
import { slugify } from "@/utils";
import type { CompleteProfileInput } from "@/lib/validations/auth";

/**
 * Provisioning of the application rows (`users` / `profiles`) that mirror a
 * Supabase-authenticated identity, plus the onboarding write that
 * /complete-profile performs.
 *
 * ─── Why this module exists (Phase 9 production fix) ───────────────────────
 * The mirror rows used to be created by a Postgres trigger on Supabase's own
 * `auth.users` table (`prisma/migrations/manual_auth_trigger.sql`). That
 * trigger only exists inside Supabase's database — it cannot fire now that
 * application data lives in an independent Postgres (Neon — ARCHITECTURE.md
 * §6c), and no application code path created the rows either. The result was
 * a Supabase-authenticated user with no `users`/`profiles` row: the onboarding
 * write's `update`s then matched nothing, Prisma raised `P2025` ("record to
 * update not found"), and the Server Action reported the generic
 * "Something went wrong saving your profile. Please try again."
 *
 * Application code now owns provisioning, idempotently, against whatever
 * Postgres `DATABASE_URL` points at. Identity (credentials, OTP, OAuth,
 * sessions) stays exactly where it was: Supabase Auth.
 *
 * ─── Why it takes a store instead of importing the Prisma client ───────────
 * The data store is a parameter so this module stays unit-testable with a
 * fake store — it deliberately does not import `@/lib/prisma` or
 * `server-only`. The real wiring (the server-only Prisma client plus the
 * Supabase Admin API call that mirrors the role into the JWT) stays in
 * `src/services/auth-service.ts`.
 */

export class AuthServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthServiceError";
  }
}

/** Any handle that can read/write the app rows: `PrismaClient` or a `$transaction` client. */
export type AccountDataStore = Pick<PrismaClient, "user" | "profile" | "seller">;

/** The subset of `PrismaClient` needed to open a transaction. */
export type TransactionalAccountDataStore = Pick<PrismaClient, "$transaction">;

/**
 * Everything the application rows need from a Supabase-authenticated user.
 * `email` is required because `users.email` is a non-null unique column;
 * `fullName` falls back to `""` exactly like the trigger did.
 */
export type AuthIdentity = {
  id: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  fullName: string;
  avatarUrl: string | null;
};

/**
 * Structural subset of Supabase's `User` (`supabase.auth.getUser()` result,
 * the payload of `signUp`/`signInWithPassword`). Deliberately structural so
 * this module doesn't depend on the Supabase SDK at runtime.
 */
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
 * Builds the identity record from a Supabase user. Mirrors what the old
 * trigger read from `raw_user_meta_data`: `full_name`, then `name` (Google
 * OAuth), then an empty string.
 */
export function authIdentityFromSupabaseUser(user: SupabaseIdentityUser): AuthIdentity {
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

/**
 * Idempotently makes sure the `users` and `profiles` rows for an authenticated
 * Supabase user exist. Safe to call on every session: an existing row is left
 * alone apart from `email`/`emailVerified`, and phone/role/name edits made by
 * the user are never overwritten.
 */
export async function ensureUserProvisioned(
  db: AccountDataStore,
  identity: AuthIdentity
): Promise<void> {
  if (!identity.email) {
    throw new AuthServiceError(
      "Your MaliHub account has no email address on file. Please contact support."
    );
  }

  await db.user.upsert({
    where: { id: identity.id },
    create: {
      id: identity.id,
      email: identity.email,
      phone: identity.phone,
      emailVerified: identity.emailVerified,
    },
    // `undefined` means "leave as-is" in Prisma: provisioning may confirm an
    // address, but it must never un-confirm one.
    update: {
      email: identity.email,
      emailVerified: identity.emailVerified || undefined,
    },
  });

  await db.profile.upsert({
    where: { userId: identity.id },
    create: {
      userId: identity.id,
      fullName: identity.fullName,
      avatarUrl: identity.avatarUrl,
    },
    update: {},
  });
}

export type CompletedProfileRole = "BUYER" | "SELLER";

/**
 * The whole /complete-profile write, in one transaction:
 *  1. provision the mirror rows (this is what makes a first-ever save work),
 *  2. claim the phone number + set the role on the user,
 *  3. finish the profile (name, county, avatar, onboarded = true),
 *  4. create a starter Seller row when they opted into selling.
 *
 * Throws `AuthServiceError` for conditions the user can fix (phone already
 * claimed, missing email); anything else propagates to the caller, which is
 * responsible for logging it rather than flattening it into generic copy.
 */
export async function saveCompletedProfile(
  db: TransactionalAccountDataStore,
  identity: AuthIdentity,
  input: CompleteProfileInput
): Promise<{ role: CompletedProfileRole; wantsToSell: boolean }> {
  const wantsToSell = input.accountIntent === "SELLER" || input.accountIntent === "BOTH";
  const role: CompletedProfileRole = wantsToSell ? "SELLER" : "BUYER";

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await ensureUserProvisioned(tx, identity);

    // Phone numbers are unique — surface a friendly conflict instead of a
    // raw Postgres constraint error if someone else already claimed it.
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

  return { role, wantsToSell };
}
