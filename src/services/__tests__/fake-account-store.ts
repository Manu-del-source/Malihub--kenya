import { randomUUID } from "node:crypto";

/**
 * An in-memory stand-in for the slice of Prisma that account provisioning uses.
 *
 * Shared by the provisioning suite and the auth-action suites so both exercise
 * the real production code against identical database semantics. It mirrors the
 * Postgres behaviour the code depends on:
 *  - `update` on a missing row throws Prisma's `P2025` ("record to update not
 *    found") — the failure a freshly initialized database used to produce;
 *  - `email` / `phone` / `auth_user_id` are UNIQUE, so a second claim raises
 *    `P2002`;
 *  - a failed `$transaction` rolls back every write made inside it.
 *
 * ─── The identity model this store encodes ─────────────────────────────────
 * The auth provider's id is NOT the application id. `users.id` stays
 * MaliHub-generated (every foreign key in the schema targets it) and the
 * provider id is mapped through the separate UNIQUE `users.auth_user_id`
 * column. Tests therefore cannot assume an application id up front — they take
 * the one provisioning returns.
 */

import type {
  AccountDataStore,
  TransactionalAccountDataStore,
} from "@/services/account-provisioning";

export class PrismaKnownError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
  }
}

export type UserRole = "BUYER" | "SELLER" | "ADMIN" | "SUPER_ADMIN";

export type UserRow = {
  id: string;
  email: string;
  /** Provider id, or null for a row predating the migration (legacy account). */
  authUserId: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  isBanned: boolean;
  emailVerified: boolean;
};

/** `role`/`phone`/flags are optional here because Postgres defaults them. */
export type UserCreate = {
  id: string;
  email: string;
  authUserId?: string | null;
  phone?: string | null;
  role?: UserRole;
  emailVerified?: boolean;
};

export type UserUpdate = Partial<Omit<UserRow, "id">>;

export type ProfileRow = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  county: string | null;
  onboarded: boolean;
};

export type ProfileCreate = {
  userId: string;
  fullName: string;
  avatarUrl?: string | null;
  county?: string | null;
  onboarded?: boolean;
};

export type ProfileUpdate = Partial<Omit<ProfileRow, "userId">>;

export type SellerRow = {
  userId: string;
  businessName: string;
  slug: string;
  county: string | null;
};

export type Tables = {
  users: Map<string, UserRow>;
  profiles: Map<string, ProfileRow>;
  sellers: Map<string, SellerRow>;
};

/** What `user.findUnique`/`findFirst` project for a resolved mapping. */
export type UserProjection = {
  id: string;
  email: string;
  authUserId: string | null;
  role: UserRole;
  isActive: boolean;
  isBanned: boolean;
  phone: string | null;
};

export const projectUser = (row: UserRow): UserProjection => ({
  id: row.id,
  email: row.email,
  authUserId: row.authUserId,
  role: row.role,
  isActive: row.isActive,
  isBanned: row.isBanned,
  phone: row.phone,
});

export type FakeStore = {
  tables: Tables;
  operations: string[];
  /** Deterministic replacement for `randomUUID()` — see `nextUserId`. */
  idSequence: string[];
  user: {
    create(args: { where?: never; data: UserCreate; select?: unknown }): Promise<UserProjection>;
    update(args: { where: { id: string }; data: UserUpdate }): Promise<UserProjection>;
    findFirst(args: {
      where: { phone?: string; email?: string; NOT?: { id: string } };
      select?: unknown;
    }): Promise<UserProjection | { id: string } | null>;
    findUnique(args: {
      where: { id?: string; authUserId?: string };
      select?: unknown;
    }): Promise<unknown>;
  };
  profile: {
    upsert(args: {
      where: { userId: string };
      create: ProfileCreate;
      update: ProfileUpdate;
    }): Promise<ProfileRow>;
    update(args: { where: { userId: string }; data: ProfileUpdate }): Promise<ProfileRow>;
  };
  seller: {
    findUnique(args: { where: { userId: string } }): Promise<SellerRow | null>;
    create(args: { data: SellerRow }): Promise<SellerRow>;
  };
  $transaction<T>(fn: (tx: FakeStore) => Promise<T>): Promise<T>;
};

export function createFakeAccountStore(): FakeStore {
  const tables: Tables = { users: new Map(), profiles: new Map(), sellers: new Map() };

  const snapshot = () => ({
    users: new Map(tables.users),
    profiles: new Map(tables.profiles),
    sellers: new Map(tables.sellers),
  });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    tables.users.clear();
    tables.profiles.clear();
    tables.sellers.clear();
    for (const [id, row] of snap.users) tables.users.set(id, row);
    for (const [id, row] of snap.profiles) tables.profiles.set(id, row);
    for (const [id, row] of snap.sellers) tables.sellers.set(id, row);
  };

  /**
   * Mirrors the unique indexes on users.email / users.phone /
   * users.auth_user_id. A NULL `auth_user_id` never collides — that is what
   * makes many legacy rows able to coexist unmapped.
   */
  function assertUniqueUser(row: UserRow, currentId: string) {
    for (const existing of tables.users.values()) {
      if (existing.id === currentId) continue;
      if (existing.email === row.email) {
        throw new PrismaKnownError("P2002", "Unique constraint failed on users.email");
      }
      if (row.phone && existing.phone === row.phone) {
        throw new PrismaKnownError("P2002", "Unique constraint failed on users.phone");
      }
      if (row.authUserId && existing.authUserId === row.authUserId) {
        throw new PrismaKnownError("P2002", "Unique constraint failed on users.auth_user_id");
      }
    }
  }

  const store: FakeStore = {
    tables,
    operations: [],
    idSequence: [],
    user: {
      async create({ data }) {
        store.operations.push(`user.create:${data.authUserId ?? "legacy"}`);
        const inserted: UserRow = {
          id: data.id,
          email: data.email,
          authUserId: data.authUserId ?? null,
          phone: data.phone ?? null,
          role: data.role ?? "BUYER",
          isActive: true,
          isBanned: false,
          emailVerified: data.emailVerified ?? false,
        };
        assertUniqueUser(inserted, inserted.id);
        tables.users.set(inserted.id, inserted);
        return projectUser(inserted);
      },
      async update({ where, data }) {
        store.operations.push(`user.update:${where.id}`);
        const existing = tables.users.get(where.id);
        if (!existing) {
          throw new PrismaKnownError(
            "P2025",
            "An operation failed because it depends on one or more records that were required but not found."
          );
        }
        const merged: UserRow = { ...existing };
        for (const [key, value] of Object.entries(data)) {
          if (value === undefined) continue;
          (merged as Record<string, unknown>)[key] = value;
        }
        assertUniqueUser(merged, where.id);
        tables.users.set(where.id, merged);
        return projectUser(merged);
      },
      async findFirst({ where }) {
        for (const row of tables.users.values()) {
          if (where.email !== undefined && row.email !== where.email) continue;
          if (where.phone !== undefined && row.phone !== where.phone) continue;
          if (where.NOT && row.id === where.NOT.id) continue;
          // The phone-conflict lookup projects only `{ id }`.
          return where.phone !== undefined ? { id: row.id } : projectUser(row);
        }
        return null;
      },
      async findUnique({ where }) {
        if (where.authUserId !== undefined) {
          store.operations.push(`user.findUnique:authUserId=${where.authUserId}`);
          for (const row of tables.users.values()) {
            if (row.authUserId === where.authUserId) return projectUser(row);
          }
          return null;
        }

        const id = where.id as string;
        store.operations.push(`user.findUnique:${id}`);
        const user = tables.users.get(id);
        if (!user) return null;

        // `getAuthoritativeOnboardingState` / `readApplicationAccess` project
        // the relations; `resolveApplicationUserId` projects the row. Answer
        // both from the same lookup.
        const seller = tables.sellers.get(id);
        return {
          ...projectUser(user),
          profile: tables.profiles.has(id)
            ? { onboarded: tables.profiles.get(id)!.onboarded }
            : null,
          seller: seller ? { id: seller.userId } : null,
        };
      },
    },
    profile: {
      async upsert({ where, create, update }) {
        store.operations.push(`profile.upsert:${where.userId}`);
        const existing = tables.profiles.get(where.userId);
        if (existing) {
          const merged: ProfileRow = { ...existing };
          for (const [key, value] of Object.entries(update)) {
            if (value === undefined) continue;
            (merged as Record<string, unknown>)[key] = value;
          }
          tables.profiles.set(where.userId, merged);
          return merged;
        }
        const inserted: ProfileRow = {
          userId: create.userId,
          fullName: create.fullName,
          avatarUrl: create.avatarUrl ?? null,
          county: create.county ?? null,
          onboarded: create.onboarded ?? false,
        };
        tables.profiles.set(where.userId, inserted);
        return { ...inserted };
      },
      async update({ where, data }) {
        store.operations.push(`profile.update:${where.userId}`);
        const existing = tables.profiles.get(where.userId);
        if (!existing) {
          throw new PrismaKnownError(
            "P2025",
            "An operation failed because it depends on one or more records that were required but not found."
          );
        }
        const merged: ProfileRow = { ...existing };
        for (const [key, value] of Object.entries(data)) {
          if (value === undefined) continue;
          (merged as Record<string, unknown>)[key] = value;
        }
        tables.profiles.set(where.userId, merged);
        return merged;
      },
    },
    seller: {
      async findUnique({ where }) {
        return tables.sellers.get(where.userId) ?? null;
      },
      async create({ data }) {
        store.operations.push(`seller.create:${data.userId}`);
        tables.sellers.set(data.userId, { ...data });
        return { ...data };
      },
    },
    async $transaction<T>(fn: (tx: FakeStore) => Promise<T>): Promise<T> {
      store.operations.push("$transaction");
      const snap = snapshot();
      const opCount = store.operations.length;
      try {
        return await fn(store);
      } catch (error) {
        restore(snap);
        store.operations.length = opCount;
        throw error;
      }
    },
  };

  return store;
}


/** Casts the fake onto the Prisma-shaped interfaces the services expect. */
export function asAccountStore(store: FakeStore) {
  return store as unknown as AccountDataStore & TransactionalAccountDataStore;
}

/** Seeds a legacy row: an application account with no provider mapping. */
export function seedLegacyRow(store: FakeStore, overrides: Partial<UserRow> = {}): UserRow {
  const row: UserRow = {
    id: `legacy-${randomUUID().slice(0, 8)}`,
    email: "legacy@example.com",
    authUserId: null,
    phone: null,
    role: "SELLER",
    isActive: true,
    isBanned: false,
    emailVerified: true,
    ...overrides,
  };
  store.tables.users.set(row.id, row);
  return row;
}
