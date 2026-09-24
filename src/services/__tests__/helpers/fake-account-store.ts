/**
 * In-memory fake of the Neon tables the account layer touches, mirroring the
 * Postgres/Prisma semantics the auth flows depend on:
 *
 *  - `users.email` and `users.phone` are unique → `P2002` on conflict;
 *  - `update`/`upsert-update` on a missing row → `P2025`;
 *  - `$transaction` rolls back every write inside it on error;
 *  - connection-class failures (`P1001`/`P1002`) can be injected, including
 *    "fail the next N calls, then recover" for the bounded-retry path.
 *
 * Every statement is recorded in `statements` so tests can assert the exact
 * query plan (e.g. "no duplicate lookups", "provisioning ran in one
 * transaction").
 */

export class FakePrismaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = code.startsWith("P2")
      ? "PrismaClientKnownRequestError"
      : "PrismaClientInitializationError";
  }
}

export type FakeUserRole = "BUYER" | "SELLER" | "ADMIN" | "SUPER_ADMIN";

export type FakeUserRow = {
  id: string;
  email: string;
  phone: string | null;
  role: FakeUserRole;
  emailVerified: boolean;
};

export type FakeProfileRow = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  county: string | null;
  onboarded: boolean;
};

export type FakeSellerRow = {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  county: string;
};

export type FakeAccountStore = {
  tables: {
    users: Map<string, FakeUserRow>;
    profiles: Map<string, FakeProfileRow>;
    sellers: Map<string, FakeSellerRow>;
  };
  /** Ordered record of every statement (e.g. "user.upsert:<id>"). */
  statements: string[];
  user: {
    upsert(args: {
      where: { id: string };
      create: Partial<FakeUserRow> & { id: string; email: string };
      update?: Partial<FakeUserRow>;
    }): Promise<FakeUserRow>;
    update(args: { where: { id: string }; data: Partial<FakeUserRow> }): Promise<FakeUserRow>;
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<Record<string, unknown> | null>;
    findFirst(args: {
      where: { phone: string; NOT?: { id: string } };
      select?: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
  };
  profile: {
    upsert(args: {
      where: { userId: string };
      create: Partial<FakeProfileRow> & { userId: string; fullName: string };
      update?: Partial<FakeProfileRow>;
    }): Promise<FakeProfileRow>;
    update(args: { where: { userId: string }; data: Partial<FakeProfileRow> }): Promise<FakeProfileRow>;
    findUnique(args: { where: { userId: string } }): Promise<FakeProfileRow | null>;
  };
  seller: {
    findUnique(args: { where: { userId: string }; select?: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: FakeSellerRow }): Promise<FakeSellerRow>;
  };
  $transaction<T>(fn: (tx: FakeAccountStore) => Promise<T>): Promise<T>;

  /* ── Test controls ── */
  /** Makes the next `times` calls to ANY statement throw `error`, then recovers. */
  enqueueFailures(error: Error, times: number): void;
  /** Makes ALL subsequent statements throw (until failures are reset). */
  failAll(error: Error): void;
  resetFailures(): void;
};

function applyDefined<T extends object>(target: T, source: Partial<T>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

export function createFakeAccountStore(): FakeAccountStore {
  const tables = {
    users: new Map<string, FakeUserRow>(),
    profiles: new Map<string, FakeProfileRow>(),
    sellers: new Map<string, FakeSellerRow>(),
  };

  const queued: Error[] = [];
  let persistent: Error | null = null;

  const snapshot = () => ({
    users: new Map(tables.users),
    profiles: new Map(tables.profiles),
    sellers: new Map(tables.sellers),
  });

  const restore = (snap: ReturnType<typeof snapshot>) => {
    tables.users = new Map(snap.users);
    tables.profiles = new Map(snap.profiles);
    tables.sellers = new Map(snap.sellers);
  };

  function maybeFail() {
    if (persistent) throw persistent;
    if (queued.length > 0) {
      const error = queued.shift()!;
      throw error;
    }
  }

  /** Mirrors the unique indexes on users.email / users.phone. */
  function assertUniqueUser(row: FakeUserRow, ignoreId: string) {
    for (const existing of tables.users.values()) {
      if (existing.id === ignoreId) continue;
      if (existing.email === row.email) {
        throw new FakePrismaError("P2002", "Unique constraint failed on users.email");
      }
      if (row.phone && existing.phone === row.phone) {
        throw new FakePrismaError("P2002", "Unique constraint failed on users.phone");
      }
    }
  }

  const store: FakeAccountStore = {
    tables,
    statements: [],

    user: {
      async upsert({ where, create, update }) {
        store.statements.push(`user.upsert:${where.id}`);
        maybeFail();
        const existing = tables.users.get(where.id);
        if (existing) {
          const merged: FakeUserRow = { ...existing };
          applyDefined(merged, update ?? {});
          assertUniqueUser(merged, where.id);
          tables.users.set(where.id, merged);
          return { ...merged };
        }
        const inserted: FakeUserRow = {
          id: create.id,
          email: create.email,
          phone: create.phone ?? null,
          role: (create.role as FakeUserRole) ?? "BUYER",
          emailVerified: create.emailVerified ?? false,
        };
        assertUniqueUser(inserted, where.id);
        tables.users.set(where.id, inserted);
        return { ...inserted };
      },

      async update({ where, data }) {
        store.statements.push(`user.update:${where.id}`);
        maybeFail();
        const existing = tables.users.get(where.id);
        if (!existing) {
          throw new FakePrismaError(
            "P2025",
            "An operation failed because it depends on one or more records that were required but not found.",
          );
        }
        const merged: FakeUserRow = { ...existing };
        applyDefined(merged, data);
        assertUniqueUser(merged, where.id);
        tables.users.set(where.id, merged);
        return { ...merged };
      },

      async findUnique({ where }) {
        store.statements.push(`user.findUnique:${where.id}`);
        maybeFail();
        const user = tables.users.get(where.id);
        if (!user) return null;
        const profile = tables.profiles.get(where.id);
        const seller = tables.sellers.get(where.id);
        return {
          id: user.id,
          role: user.role,
          email: user.email,
          phone: user.phone,
          emailVerified: user.emailVerified,
          profile: profile
            ? {
                fullName: profile.fullName,
                avatarUrl: profile.avatarUrl,
                county: profile.county,
                onboarded: profile.onboarded,
              }
            : null,
          seller: seller ? { id: seller.id } : null,
        };
      },

      async findFirst({ where }) {
        store.statements.push(`user.findFirst:phone=${where.phone}`);
        maybeFail();
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
        store.statements.push(`profile.upsert:${where.userId}`);
        maybeFail();
        const existing = tables.profiles.get(where.userId);
        if (existing) {
          const merged: FakeProfileRow = { ...existing };
          applyDefined(merged, update ?? {});
          tables.profiles.set(where.userId, merged);
          return { ...merged };
        }
        const inserted: FakeProfileRow = {
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
        store.statements.push(`profile.update:${where.userId}`);
        maybeFail();
        const existing = tables.profiles.get(where.userId);
        if (!existing) {
          throw new FakePrismaError(
            "P2025",
            "An operation failed because it depends on one or more records that were required but not found.",
          );
        }
        const merged: FakeProfileRow = { ...existing };
        applyDefined(merged, data);
        tables.profiles.set(where.userId, merged);
        return { ...merged };
      },

      async findUnique({ where }) {
        store.statements.push(`profile.findUnique:${where.userId}`);
        maybeFail();
        const row = tables.profiles.get(where.userId);
        return row ? { ...row } : null;
      },
    },

    seller: {
      async findUnique({ where }) {
        store.statements.push(`seller.findUnique:${where.userId}`);
        maybeFail();
        const row = tables.sellers.get(where.userId);
        return row ? { id: row.id, userId: row.userId } : null;
      },

      async create({ data }) {
        store.statements.push(`seller.create:${data.userId}`);
        maybeFail();
        if (tables.sellers.has(data.userId)) {
          throw new FakePrismaError("P2002", "Unique constraint failed on sellers.user_id");
        }
        const inserted: FakeSellerRow = { ...data };
        tables.sellers.set(data.userId, inserted);
        return { ...inserted };
      },
    },

    async $transaction<T>(fn: (tx: FakeAccountStore) => Promise<T>): Promise<T> {
      const snap = snapshot();
      try {
        return await fn(store);
      } catch (error) {
        // Roll back table data only — the statement log is an observability
        // record and keeps failed attempts (so retry behavior is assertable).
        restore(snap);
        store.statements.push("$transaction:rollback");
        throw error;
      }
    },

    enqueueFailures(error, times) {
      for (let i = 0; i < times; i += 1) queued.push(error);
    },
    failAll(error) {
      persistent = error;
    },
    resetFailures() {
      queued.length = 0;
      persistent = null;
    },
  };

  return store;
}

/** Seeds a fully-provisioned account in the store. */
export function seedAccount(
  store: FakeAccountStore,
  args: {
    id: string;
    email: string;
    phone?: string | null;
    role?: FakeUserRole;
    onboarded?: boolean;
    fullName?: string;
    avatarUrl?: string | null;
    county?: string | null;
    seller?: { businessName?: string; slug?: string; county?: string };
  },
): void {
  const {
    id,
    email,
    phone = null,
    role = "BUYER",
    onboarded = false,
    fullName = "Test User",
    avatarUrl = null,
    county = null,
  } = args;

  store.tables.users.set(id, { id, email, phone, role, emailVerified: true });
  store.tables.profiles.set(id, { userId: id, fullName, avatarUrl, county, onboarded });
  if (args.seller) {
    store.tables.sellers.set(id, {
      id: `seller-${id}`,
      userId: id,
      businessName: args.seller.businessName ?? "Test Business",
      slug: args.seller.slug ?? `test-business-${id.slice(0, 8)}`,
      county: args.seller.county ?? "Nairobi",
    });
  }
}
