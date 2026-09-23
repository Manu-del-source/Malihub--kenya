import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthServiceError,
  authIdentityFromSupabaseUser,
  ensureUserProvisioned,
  saveCompletedProfile,
  type AccountDataStore,
  type AuthIdentity,
  type TransactionalAccountDataStore,
} from "@/services/account-provisioning";
import type { CompleteProfileInput } from "@/lib/validations/auth";

/**
 * These tests pin the production failure and its fix.
 *
 * The store below mirrors the Postgres semantics the bug depended on:
 *  - `update`/`findUnique` on a row that does not exist throws Prisma's
 *    `P2025` ("record to update not found") — which is exactly what the
 *    onboarding action hit when Supabase authenticated a user whose
 *    `users`/`profiles` rows had never been created in Neon;
 *  - `phone`/`email` are unique, so a second claim raises `P2002`;
 *  - a failed `$transaction` rolls back every write inside it.
 */

class PrismaKnownError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
  }
}

type UserRole = "BUYER" | "SELLER" | "ADMIN" | "SUPER_ADMIN";

type UserRow = {
  id: string;
  email: string;
  phone: string | null;
  role: UserRole;
  emailVerified: boolean;
};

/** `role`/`phone`/`emailVerified` are optional here because Postgres defaults them. */
type UserCreate = {
  id: string;
  email: string;
  phone?: string | null;
  role?: UserRole;
  emailVerified?: boolean;
};

type UserUpdate = Partial<Omit<UserRow, "id">>;

type ProfileRow = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  county: string | null;
  onboarded: boolean;
};

type ProfileCreate = {
  userId: string;
  fullName: string;
  avatarUrl?: string | null;
  county?: string | null;
  onboarded?: boolean;
};

type ProfileUpdate = Partial<Omit<ProfileRow, "userId">>;

type SellerRow = {
  userId: string;
  businessName: string;
  slug: string;
  county: string | null;
};

type Tables = {
  users: Map<string, UserRow>;
  profiles: Map<string, ProfileRow>;
  sellers: Map<string, SellerRow>;
};

type FakeStore = {
  tables: Tables;
  operations: string[];
  user: {
    upsert(args: {
      where: { id: string };
      create: UserCreate;
      update: UserUpdate;
    }): Promise<UserRow>;
    update(args: { where: { id: string }; data: UserUpdate }): Promise<UserRow>;
    findFirst(args: {
      where: { phone: string; NOT?: { id: string } };
      select?: { id: boolean };
    }): Promise<{ id: string } | null>;
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

function createFakeAccountStore(): FakeStore {
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

  /** Mirrors the unique indexes on users.email / users.phone. */
  function assertUniqueUser(row: UserRow, currentId: string) {
    for (const existing of tables.users.values()) {
      if (existing.id !== currentId && existing.email === row.email) {
        throw new PrismaKnownError("P2002", "Unique constraint failed on users.email");
      }
      if (row.phone && existing.id !== currentId && existing.phone === row.phone) {
        throw new PrismaKnownError("P2002", "Unique constraint failed on users.phone");
      }
    }
  }

  const store: FakeStore = {
    tables,
    operations: [],
    user: {
      async upsert({ where, create, update }) {
        store.operations.push(`user.upsert:${where.id}`);
        const existing = tables.users.get(where.id);
        if (existing) {
          const merged: UserRow = { ...existing };
          for (const [key, value] of Object.entries(update)) {
            if (value === undefined) continue;
            (merged as Record<string, unknown>)[key] = value;
          }
          assertUniqueUser(merged, where.id);
          tables.users.set(where.id, merged);
          return merged;
        }
        const inserted: UserRow = {
          id: create.id,
          email: create.email,
          phone: create.phone ?? null,
          role: create.role ?? "BUYER",
          emailVerified: create.emailVerified ?? false,
        };
        assertUniqueUser(inserted, where.id);
        tables.users.set(where.id, inserted);
        return { ...inserted };
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
        return merged;
      },
      async findFirst({ where }) {
        for (const row of tables.users.values()) {
          if (row.phone !== where.phone) continue;
          if (where.NOT && row.id === where.NOT.id) continue;
          return { id: row.id };
        }
        return null;
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

const EMMANUEL = {
  id: "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d",
  email: "emmanuel@example.com",
  phone: null,
  email_confirmed_at: "2026-09-20T08:15:00.000Z",
  user_metadata: { full_name: "Emmanuel Yegon" },
};

const IDENTITY: AuthIdentity = authIdentityFromSupabaseUser(EMMANUEL);

const COMPLETE_INPUT: CompleteProfileInput = {
  fullName: "Emmanuel Yegon",
  phone: "+254726090372",
  county: "Uasin Gishu",
  accountIntent: "BOTH",
  avatarUrl: "",
};

function asStore(store: FakeStore) {
  return store as unknown as AccountDataStore & TransactionalAccountDataStore;
}

describe("account provisioning — freshly initialized database", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = createFakeAccountStore();
  });

  it("fails the way production failed when the rows were never provisioned (regression guard)", async () => {
    // No provisioning step: this is the pre-fix behaviour — the action updated
    // rows that a Supabase-only signup never created in this database.
    await assert.rejects(
      () => store.user.update({ where: { id: IDENTITY.id }, data: { phone: "+254726090372" } }),
      (error: unknown) =>
        error instanceof PrismaKnownError &&
        error.code === "P2025" &&
        error.name === "PrismaClientKnownRequestError"
    );
    await assert.rejects(
      () => store.profile.update({ where: { userId: IDENTITY.id }, data: { onboarded: true } }),
      (error: unknown) => error instanceof PrismaKnownError && error.code === "P2025"
    );
  });

  it("completes the first-ever profile save for an authenticated user with no rows", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);

    assert.deepEqual(result, { role: "SELLER", wantsToSell: true });

    const user = store.tables.users.get(IDENTITY.id);
    assert.ok(user, "the users row is created");
    assert.equal(user.email, "emmanuel@example.com");
    assert.equal(user.phone, "+254726090372");
    assert.equal(user.role, "SELLER");
    assert.equal(user.emailVerified, true);

    const profile = store.tables.profiles.get(IDENTITY.id);
    assert.ok(profile, "the profiles row is created");
    assert.equal(profile.fullName, "Emmanuel Yegon");
    assert.equal(profile.county, "Uasin Gishu");
    assert.equal(profile.onboarded, true);

    const seller = store.tables.sellers.get(IDENTITY.id);
    assert.ok(seller, "a starter Seller row is created for accountIntent BOTH");
    assert.equal(seller.businessName, "Emmanuel Yegon");
    assert.equal(seller.county, "Uasin Gishu");
    assert.match(seller.slug, /^emmanuel-yegon-/);
  });

  it("provisions the rows before it updates them (the ordering the fix depends on)", async () => {
    await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);

    const provisionedAt = store.operations.indexOf(`user.upsert:${IDENTITY.id}`);
    const updatedAt = store.operations.indexOf(`user.update:${IDENTITY.id}`);
    const profileProvisionedAt = store.operations.indexOf(`profile.upsert:${IDENTITY.id}`);
    const profileUpdatedAt = store.operations.indexOf(`profile.update:${IDENTITY.id}`);

    assert.ok(provisionedAt >= 0 && updatedAt >= 0 && profileProvisionedAt >= 0 && profileUpdatedAt >= 0);
    assert.ok(provisionedAt < updatedAt, "users row is created before it is updated");
    assert.ok(profileProvisionedAt < profileUpdatedAt, "profiles row is created before it is updated");
  });

  it("saves a buyer profile without creating a Seller row", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...COMPLETE_INPUT,
      accountIntent: "BUYER",
    });

    assert.deepEqual(result, { role: "BUYER", wantsToSell: false });
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "BUYER");
    assert.equal(store.tables.sellers.size, 0);
  });

  it("provisions whichever of the two rows is missing", async () => {
    // users row exists, profiles row does not (a partially provisioned account)
    await ensureUserProvisioned(asStore(store), IDENTITY);
    store.tables.profiles.clear();

    await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.onboarded, true);

    // profiles row exists, users row does not
    const second = createFakeAccountStore();
    const other: AuthIdentity = { ...IDENTITY, id: "11111111-2222-3333-4444-555555555555" };
    await ensureUserProvisioned(asStore(second), other);
    second.tables.users.clear();

    await saveCompletedProfile(asStore(second), other, COMPLETE_INPUT);
    assert.equal(second.tables.users.get(other.id)?.role, "SELLER");
    assert.equal(second.tables.profiles.get(other.id)?.onboarded, true);
  });
});

describe("account provisioning — existing accounts", () => {
  let store: FakeStore;

  beforeEach(async () => {
    store = createFakeAccountStore();
    await ensureUserProvisioned(asStore(store), IDENTITY);
  });

  it("is idempotent and never clobbers a phone, role or name the user already set", async () => {
    store.tables.users.set(IDENTITY.id, {
      id: IDENTITY.id,
      email: "emmanuel@example.com",
      phone: "0712345678",
      role: "SELLER",
      emailVerified: true,
    });
    store.tables.profiles.set(IDENTITY.id, {
      userId: IDENTITY.id,
      fullName: "Emmanuel K. Yegon",
      avatarUrl: "https://cdn.example.com/a.png",
      county: "Nairobi",
      onboarded: true,
    });

    await ensureUserProvisioned(asStore(store), IDENTITY);

    assert.equal(store.tables.users.size, 1);
    assert.equal(store.tables.profiles.size, 1);
    assert.equal(store.tables.users.get(IDENTITY.id)?.phone, "0712345678");
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "SELLER");
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.fullName, "Emmanuel K. Yegon");
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.county, "Nairobi");
  });

  it("keeps an existing Seller row instead of creating a second one", async () => {
    store.tables.sellers.set(IDENTITY.id, {
      userId: IDENTITY.id,
      businessName: "Yegon Electronics",
      slug: "yegon-electronics-ab12c",
      county: "Uasin Gishu",
    });

    await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);

    assert.equal(store.tables.sellers.size, 1);
    assert.equal(store.tables.sellers.get(IDENTITY.id)?.businessName, "Yegon Electronics");
  });

  it("completes a returning user's profile", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...COMPLETE_INPUT,
      accountIntent: "SELLER",
    });

    assert.deepEqual(result, { role: "SELLER", wantsToSell: true });
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.onboarded, true);
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.county, "Uasin Gishu");
  });

  it("rejects a phone number that belongs to another account and rolls the write back", async () => {
    const taken: AuthIdentity = {
      ...IDENTITY,
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: "other@example.com",
    };
    await ensureUserProvisioned(asStore(store), taken);
    await store.user.update({ where: { id: taken.id }, data: { phone: "+254726090372" } });

    await assert.rejects(
      () => saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT),
      (error: unknown) =>
        error instanceof AuthServiceError &&
        error.message === "That phone number is already linked to another MaliHub account."
    );

    // The transaction rolled back: nothing was partially written.
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "BUYER");
    assert.equal(store.tables.users.get(IDENTITY.id)?.phone, null);
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.onboarded, false);
    assert.equal(store.tables.sellers.size, 0);
  });

  it("refuses to provision an identity without an email address", async () => {
    await assert.rejects(
      () => ensureUserProvisioned(asStore(store), { ...IDENTITY, email: "" }),
      (error: unknown) => error instanceof AuthServiceError
    );
  });
});

describe("authIdentityFromSupabaseUser", () => {
  it("reads the same metadata the Supabase trigger used to", () => {
    assert.deepEqual(authIdentityFromSupabaseUser(EMMANUEL), {
      id: EMMANUEL.id,
      email: "emmanuel@example.com",
      phone: null,
      emailVerified: true,
      fullName: "Emmanuel Yegon",
      avatarUrl: null,
    });
  });

  it("falls back to Google's `name`/`avatar_url` claims, then to an empty name", () => {
    const google = authIdentityFromSupabaseUser({
      id: "id-1",
      email: "g@example.com",
      email_confirmed_at: null,
      user_metadata: { name: "Google User", avatar_url: "https://lh3.googleusercontent.com/a/x" },
    });
    assert.equal(google.fullName, "Google User");
    assert.equal(google.avatarUrl, "https://lh3.googleusercontent.com/a/x");
    assert.equal(google.emailVerified, false);

    const bare = authIdentityFromSupabaseUser({ id: "id-2", email: "b@example.com" });
    assert.equal(bare.fullName, "");
    assert.equal(bare.phone, null);
  });
});
