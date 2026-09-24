import type { PrismaClient, UserRole } from "@prisma/client";
import { slugify } from "@/utils";
import type { CompleteProfileInput } from "@/lib/validations/auth";

/**
 * The authoritative account layer — pure, store-injected, server-agnostic.
 *
 * ─── What this module is (post auth-architecture audit) ──────────────────
 * The ONE authoritative implementation of three operations, each used by
 * every auth entry point (sign-in, sign-up, OAuth/email callback,
 * /complete-profile):
 *
 *   getApplicationAccountState(userId)
 *       Read-only canonical Neon state. Distinguishes ACCOUNT_EXISTS from
 *       ACCOUNT_MISSING. Database failures PROPAGATE — a missing account and
 *       a database outage are different conditions and must never be
 *       conflated (a lookup failure must never become `onboarded: false`).
 *
 *   ensureApplicationAccount(identity)
 *       Idempotent provisioning boundary: one transaction that makes the
 *       `users` + `profiles` rows exist and returns the canonical state.
 *       Existing rows are left alone apart from `email`/`emailVerified`;
 *       user-set phone/role/name are never overwritten; no role can be
 *       created above BUYER (the schema default).
 *
 *   saveCompletedProfile(identity, input)
 *       The whole /complete-profile write in one transaction, with SAFE ROLE
 *       RULES: staff roles (ADMIN/SUPER_ADMIN) are never touched, an existing
 *       SELLER is never downgraded, and a Seller row is only ever created,
 *       never deleted. Returns the committed canonical state, so callers
 *       never re-query Neon to learn what was just committed.
 *
 * ─── Why this takes a store instead of importing the Prisma client ───────
 * The data store is a parameter so this module stays unit-testable with a
 * fake store — it deliberately does not import `@/lib/prisma` or
 * `server-only`. The real wiring (server-only Prisma client, Supabase Admin
 * API, classification, logging) lives in `src/services/auth-service.ts`.
 *
 * ─── History (Phase 9 production fix, kept for context) ──────────────────
 * The mirror rows used to be created by a Postgres trigger on Supabase's own
 * `auth.users` table (`prisma/migrations/manual_auth_trigger.sql`). That
 * trigger only exists inside Supabase's database — it cannot fire now that
 * application data lives in an independent Postgres (Neon —
 * ARCHITECTURE.md §6c). Application code owns provisioning idempotently.
 */

/**
 * User-fixable condition surfaced verbatim to the UI (phone already claimed,
 * identity without an email). Infrastructure failures are NOT wrapped in this
 * class — they propagate raw and are classified in `auth-service.ts`.
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

/** Store shape used by the transactional operations. */
export type AccountTransactionStore = AccountDataStore & TransactionalAccountDataStore;

/**
 * Everything the application rows need from a Supabase-authenticated user.
 * `email` is required because `users.email` is a non-null unique column;
 * `fullName` falls back to `""` (Google OAuth carries `name`).
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
 * the payload of `signUp`/`signInWithPassword`/`exchangeCodeForSession`).
 * Deliberately structural so this module doesn't depend on the Supabase SDK
 * at runtime.
 */
export type SupabaseIdentityUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

/**
 * The canonical application account state — the single shape every auth
 * entry point routes decisions from, and the source of the Supabase
 * app_metadata claims. Neon is authoritative for every field; Supabase
 * app_metadata is a mirror of this and must never be used to produce it.
 */
export type ApplicationAccountState = {
  userId: string;
  /** False ONLY for the ACCOUNT_MISSING case; after `ensureApplicationAccount` this is always true. */
  exists: boolean;
  role: UserRole;
  onboarded: boolean;
  /** Derived from the Seller ROW (not the role) — matches middleware and §5a. */
  hasSellerProfile: boolean;
  /** Profile fields pages need; null when no profile row exists. */
  profile: {
    fullName: string;
    avatarUrl: string | null;
    county: string | null;
  } | null;
};

/** ACCOUNT_EXISTS | ACCOUNT_MISSING. A database failure is an exception, never a status here. */
export type AccountLookupStatus = "EXISTS" | "MISSING";

export type AccountLookupResult = {
  status: AccountLookupStatus;
  state: ApplicationAccountState;
};

/**
 * Reads the canonical application state from Neon (the source of truth).
 *
 * - Row absent  → `{ status: "MISSING", state: <incomplete BUYER> }` — a
 *   normal condition, NOT an error; provisioning creates the rows.
 * - DB failure  → propagates. Callers classify it (DATABASE_UNAVAILABLE) and
 *   fail closed. NEVER converted into `onboarded: false` here.
 */
export async function getApplicationAccountState(
  db: AccountDataStore,
  userId: string,
): Promise<AccountLookupResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      profile: { select: { fullName: true, avatarUrl: true, county: true, onboarded: true } },
      seller: { select: { id: true } },
    },
  });

  if (!user) {
    return {
      status: "MISSING",
      state: {
        userId,
        exists: false,
        role: "BUYER",
        onboarded: false,
        hasSellerProfile: false,
        profile: null,
      },
    };
  }

  return {
    status: "EXISTS",
    state: {
      userId,
      exists: true,
      role: user.role,
      onboarded: user.profile?.onboarded === true,
      hasSellerProfile: Boolean(user.seller),
      profile: user.profile
        ? {
            fullName: user.profile.fullName,
            avatarUrl: user.profile.avatarUrl,
            county: user.profile.county,
          }
        : null,
    },
  };
}

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
 * The ONE idempotent provisioning boundary: ensures the `users` and
 * `profiles` rows for an authenticated Supabase identity exist, in a single
 * transaction, and returns the canonical state (so callers never issue a
 * second lookup to learn what was just made to exist).
 *
 * Safety properties:
 *  - existing rows are left alone apart from `email` and
 *    `emailVerified` (confirm-only — a confirmed address is never un-confirmed);
 *  - phone/role/name/county edits made by the user are never overwritten;
 *  - the only role a created row gets is the schema default (BUYER) —
 *    provisioning can never grant privileges;
 *  - identity without an email → `AuthServiceError` (user-accountable,
 *    logged distinctly).
 *
 * Database failures propagate raw; `auth-service.ts` classifies them.
 */
export async function ensureApplicationAccount(
  db: AccountTransactionStore,
  identity: AuthIdentity,
): Promise<ApplicationAccountState> {
  if (!identity.email) {
    throw new AuthServiceError(
      "Your MaliHub account has no email address on file. Please contact support.",
    );
  }

  const { user, profile, seller } = await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
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

    const profile = await tx.profile.upsert({
      where: { userId: identity.id },
      create: {
        userId: identity.id,
        fullName: identity.fullName,
        avatarUrl: identity.avatarUrl,
      },
      update: {},
    });

    const seller = await tx.seller.findUnique({
      where: { userId: identity.id },
      select: { id: true },
    });

    return { user, profile, seller };
  });

  return {
    userId: identity.id,
    exists: true,
    role: user.role,
    onboarded: profile.onboarded === true,
    hasSellerProfile: Boolean(seller),
    profile: {
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
      county: profile.county,
    },
  };
}

/**
 * Role decision for /complete-profile. The single place in the app that maps
 * (existing role, intent) → final role. Rules:
 *
 *  - ADMIN / SUPER_ADMIN are staff-only (set manually, never through any
 *    user-facing flow) — profile completion must NEVER touch them;
 *  - an existing SELLER is never downgraded to BUYER (choosing "Buyer" at
 *    onboarding re-runs cannot strip seller status; a Seller row, if present,
 *    is authoritative for seller-dashboard access anyway);
 *  - BUYER → SELLER when the user opts into selling, else BUYER.
 *
 * Client input can therefore only ever produce BUYER or SELLER, and only by
 * escalating a plain BUYER — never by picking or preserving a privileged
 * role.
 */
export function decideProfileRole(currentRole: UserRole, wantsToSell: boolean): UserRole {
  if (currentRole === "ADMIN" || currentRole === "SUPER_ADMIN") return currentRole;
  if (currentRole === "SELLER") return "SELLER";
  return wantsToSell ? "SELLER" : "BUYER";
}

export type SaveCompletedProfileResult = {
  /** The committed canonical state — callers route from this, not from JWT claims. */
  state: ApplicationAccountState;
  wantsToSell: boolean;
  /** Convenience alias of `state.role`. */
  role: UserRole;
};

/**
 * The whole /complete-profile write, in one transaction:
 *  1. provision the mirror rows (makes a first-ever save work even if
 *     sign-up/sign-in provisioning never ran);
 *  2. claim the phone number and apply the role rules (`decideProfileRole`);
 *  3. finish the profile (name, county, avatar, onboarded = true);
 *  4. create a starter Seller row when they opted into selling — only ever
 *     created, never deleted or modified.
 *
 * The committed canonical state is returned so the caller can sync Supabase
 * app_metadata and choose the dashboard without re-querying Neon.
 *
 * Throws `AuthServiceError` for conditions the user can fix (phone already
 * claimed, missing email); database failures propagate raw for the caller to
 * classify.
 */
export async function saveCompletedProfile(
  db: AccountTransactionStore,
  identity: AuthIdentity,
  input: CompleteProfileInput,
): Promise<SaveCompletedProfileResult> {
  const wantsToSell = input.accountIntent === "SELLER" || input.accountIntent === "BOTH";

  const committed = await db.$transaction(
    async (tx): Promise<SaveCompletedProfileResult> => {
      // 1. Provision inside the same transaction that updates — the P2025
    //    ("record to update not found") failure a freshly initialized
    //    database used to produce is impossible by construction.
    const user = await tx.user.upsert({
      where: { id: identity.id },
      create: {
        id: identity.id,
        email: identity.email,
        phone: identity.phone,
        emailVerified: identity.emailVerified,
      },
      update: {
        email: identity.email,
        emailVerified: identity.emailVerified || undefined,
      },
    });

    await tx.profile.upsert({
      where: { userId: identity.id },
      create: {
        userId: identity.id,
        fullName: identity.fullName,
        avatarUrl: identity.avatarUrl,
      },
      update: {},
    });

    // 2. Phone numbers are unique — surface a friendly conflict instead of a
    //    raw Postgres constraint error (the P2002 race is still caught by the
    //    action's classifier as a backstop).
    const existingPhone = await tx.user.findFirst({
      where: { phone: input.phone, NOT: { id: identity.id } },
      select: { id: true },
    });
    if (existingPhone) {
      throw new AuthServiceError(
        "That phone number is already linked to another MaliHub account.",
      );
    }

    const role = decideProfileRole(user.role, wantsToSell);

    await tx.user.update({
      where: { id: identity.id },
      data: { phone: input.phone, role },
    });

    // 3. Finish the profile.
    await tx.profile.update({
      where: { userId: identity.id },
      data: {
        fullName: input.fullName,
        county: input.county,
        avatarUrl: input.avatarUrl || null,
        onboarded: true,
      },
    });

    // 4. Starter Seller row when selling is wanted AND the resulting role is
    // actually SELLER. Privileged roles (ADMIN/SUPER_ADMIN) are preserved by
    // `decideProfileRole`, and their access grants stay OUT of the onboarding
    // form's reach — client input must not grant seller state to an admin.
    // A Seller row, once created, is kept forever (never deleted or modified
    // here).
    const grantSellerAccess = wantsToSell && role === "SELLER";
    let hasSellerProfile = false;
    if (grantSellerAccess) {
      const existingSeller = await tx.seller.findUnique({ where: { userId: identity.id } });
      if (existingSeller) {
        hasSellerProfile = true;
      } else {
        await tx.seller.create({
          data: {
            userId: identity.id,
            businessName: input.fullName,
            slug: slugify(input.fullName),
            county: input.county,
          },
        });
        hasSellerProfile = true;
      }
    } else {
      const existingSeller = await tx.seller.findUnique({ where: { userId: identity.id } });
      hasSellerProfile = Boolean(existingSeller);
    }

    // The committed truth, computed from the transaction itself and RETURNED
    // through the transaction boundary — no extra round trip, and no
    // cross-closure mutation of an outer variable.
    return {
      state: {
        userId: identity.id,
        exists: true,
        role,
        onboarded: true,
        hasSellerProfile,
        profile: {
          fullName: input.fullName,
          avatarUrl: input.avatarUrl || null,
          county: input.county,
        },
      },
      wantsToSell,
      role,
    };
  });

  return committed;
}

/**
 * The dashboard a user lands on, from canonical state (never from JWT
 * claims). Seller access follows the Seller ROW, matching middleware and
 * ARCHITECTURE.md §5a — every role can still buy.
 */
export function dashboardFor(
  state: Pick<ApplicationAccountState, "hasSellerProfile">,
): string {
  return state.hasSellerProfile ? "/dashboard/seller" : "/dashboard/buyer";
}

/**
 * Backward-compatible standalone row provisioning (kept for call sites that
 * only need the rows and do not want a transaction boundary, and for tests).
 * `ensureApplicationAccount` is the preferred boundary.
 */
export async function ensureUserProvisioned(
  db: AccountDataStore,
  identity: AuthIdentity,
): Promise<void> {
  if (!identity.email) {
    throw new AuthServiceError(
      "Your MaliHub account has no email address on file. Please contact support.",
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
