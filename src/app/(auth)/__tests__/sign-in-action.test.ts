import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { ApiResult } from "@/types";

/**
 * Regression coverage for existing users whose Supabase JWT metadata is stale
 * relative to Neon. The real signInAction → auth-service → provisioning chain
 * runs against in-memory Prisma and Supabase boundaries; no network,
 * credentials, or production database is involved.
 */

const events: string[] = [];
const USER_ID = "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";

type UserRole = "BUYER" | "SELLER" | "ADMIN" | "SUPER_ADMIN";
type UserRow = {
  id: string;
  email: string;
  phone: string | null;
  role: UserRole;
  emailVerified: boolean;
};
type ProfileRow = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  onboarded: boolean;
};
type SellerRow = { id: string; userId: string };

const db = {
  users: new Map<string, UserRow>(),
  profiles: new Map<string, ProfileRow>(),
  sellers: new Map<string, SellerRow>(),
};

let supabaseAppMetadata: Record<string, unknown> = {};
let lookupError: Error | null = null;
let provisionError: Error | null = null;
let metadataSyncBehavior: { error?: { message: string }; throw?: Error } = {};
let refreshBehavior: { error?: { message: string }; throw?: Error } = {};
let lastMetadataAttempt: {
  userId: string;
  app_metadata: Record<string, unknown>;
} | null = null;
let lastSuccessfulMetadataUpdate: {
  userId: string;
  app_metadata: Record<string, unknown>;
} | null = null;

function authenticatedUser() {
  return {
    id: USER_ID,
    email: "emmanuel@example.com",
    phone: null,
    email_confirmed_at: "2026-09-20T08:15:00.000Z",
    app_metadata: { ...supabaseAppMetadata },
    user_metadata: { full_name: "Emmanuel Yegon" },
  };
}

const fakePrisma = {
  user: {
    async upsert({
      where,
      create,
      update,
    }: {
      where: { id: string };
      create: Omit<UserRow, "role">;
      update: Partial<UserRow>;
    }) {
      events.push("neon:user-upsert");
      if (provisionError) throw provisionError;
      const existing = db.users.get(where.id);
      if (existing) {
        const next = { ...existing };
        for (const [key, value] of Object.entries(update)) {
          if (value !== undefined)
            (next as Record<string, unknown>)[key] = value;
        }
        db.users.set(where.id, next);
        return next;
      }
      const inserted: UserRow = { ...create, role: "BUYER" };
      db.users.set(where.id, inserted);
      return inserted;
    },
    async findUnique({ where }: { where: { id: string } }) {
      events.push("neon:onboarding-state");
      if (lookupError) throw lookupError;
      const user = db.users.get(where.id);
      if (!user) return null;
      const profile = db.profiles.get(where.id);
      const seller = db.sellers.get(where.id);
      return {
        role: user.role,
        profile: profile ? { onboarded: profile.onboarded } : null,
        seller: seller ? { id: seller.id } : null,
      };
    },
  },
  profile: {
    async upsert({
      where,
      create,
    }: {
      where: { userId: string };
      create: Omit<ProfileRow, "onboarded">;
    }) {
      events.push("neon:profile-upsert");
      if (provisionError) throw provisionError;
      const existing = db.profiles.get(where.userId);
      if (existing) return existing;
      const inserted: ProfileRow = { ...create, onboarded: false };
      db.profiles.set(where.userId, inserted);
      return inserted;
    },
  },
  seller: {},
  async $transaction() {
    throw new Error("not used by sign-in tests");
  },
};

const fakeSessionClient = {
  auth: {
    async signInWithPassword() {
      events.push("session:sign-in");
      return { data: { user: authenticatedUser(), session: {} }, error: null };
    },
    async refreshSession() {
      events.push("session:refresh");
      if (refreshBehavior.throw) throw refreshBehavior.throw;
      return {
        data: { user: authenticatedUser(), session: {} },
        error: refreshBehavior.error ?? null,
      };
    },
    async signOut() {
      events.push("session:sign-out");
      return { error: null };
    },
  },
};

const fakeServiceRoleClient = {
  auth: {
    admin: {
      async updateUserById(
        userId: string,
        attributes: { app_metadata: Record<string, unknown> },
      ) {
        events.push("app_metadata:update");
        lastMetadataAttempt = { userId, app_metadata: attributes.app_metadata };
        if (metadataSyncBehavior.throw) throw metadataSyncBehavior.throw;
        if (metadataSyncBehavior.error) {
          return { data: { user: null }, error: metadataSyncBehavior.error };
        }
        lastSuccessfulMetadataUpdate = {
          userId,
          app_metadata: attributes.app_metadata,
        };
        supabaseAppMetadata = { ...attributes.app_metadata };
        return { data: { user: authenticatedUser() }, error: null };
      },
    },
  },
};

mock.module("server-only", { namedExports: {} });
mock.module("next/navigation", { namedExports: { redirect: () => undefined } });
mock.module("next/headers", {
  namedExports: { headers: async () => new Map() },
});
mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => fakeSessionClient,
    createServiceRoleClient: () => fakeServiceRoleClient,
  },
});

let actionModule: typeof import("@/app/(auth)/actions") | null = null;
async function loadAction() {
  actionModule ??= await import("@/app/(auth)/actions");
  return actionModule;
}

const LOGIN = { email: "emmanuel@example.com", password: "Password1" };

function seedAccount({
  onboarded,
  role = "BUYER",
  hasSellerProfile = false,
}: {
  onboarded: boolean;
  role?: UserRole;
  hasSellerProfile?: boolean;
}) {
  db.users.set(USER_ID, {
    id: USER_ID,
    email: LOGIN.email,
    phone: "+254726090372",
    role,
    emailVerified: true,
  });
  db.profiles.set(USER_ID, {
    userId: USER_ID,
    fullName: "Emmanuel Yegon",
    avatarUrl: null,
    onboarded,
  });
  if (hasSellerProfile) {
    db.sellers.set(USER_ID, { id: "seller-profile-id", userId: USER_ID });
  }
}

function resetFakes() {
  events.length = 0;
  db.users.clear();
  db.profiles.clear();
  db.sellers.clear();
  supabaseAppMetadata = {};
  lookupError = null;
  provisionError = null;
  metadataSyncBehavior = {};
  refreshBehavior = {};
  lastMetadataAttempt = null;
  lastSuccessfulMetadataUpdate = null;
}

function assertSuccessfulRedirect(
  result: ApiResult<{ redirectTo: string }>,
  expected: string,
): void {
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.redirectTo, expected);
}

describe("signInAction — authoritative Neon onboarding repair", () => {
  beforeEach(resetFakes);

  it("repairs missing metadata for an existing onboarded BUYER before returning dashboard/buyer", async () => {
    seedAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assertSuccessfulRedirect(result, "/dashboard/buyer");
    assert.deepEqual(lastSuccessfulMetadataUpdate, {
      userId: USER_ID,
      app_metadata: {
        onboarded: true,
        role: "BUYER",
        has_seller_profile: false,
      },
    });
    assert.equal(
      events.filter((event) => event === "session:refresh").length,
      1,
    );
    assert.ok(
      events.indexOf("neon:onboarding-state") >
        events.indexOf("neon:profile-upsert"),
      "authoritative state is read after provisioning",
    );
    assert.ok(
      events.indexOf("session:refresh") > events.indexOf("app_metadata:update"),
      "the cookie-backed session refresh follows metadata repair",
    );
    assert.equal(
      events.at(-1),
      "session:refresh",
      "the successful action result is produced only after refresh resolves",
    );
  });

  it("repairs metadata for an onboarded SELLER and returns dashboard/seller", async () => {
    seedAccount({ onboarded: true, role: "SELLER", hasSellerProfile: true });
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assertSuccessfulRedirect(result, "/dashboard/seller");
    assert.deepEqual(lastSuccessfulMetadataUpdate?.app_metadata, {
      onboarded: true,
      role: "SELLER",
      has_seller_profile: true,
    });
    assert.equal(events.at(-1), "session:refresh");
  });

  it("keeps an incomplete Neon profile on /complete-profile and mirrors onboarded=false", async () => {
    seedAccount({ onboarded: false });
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assertSuccessfulRedirect(result, "/complete-profile");
    assert.deepEqual(lastSuccessfulMetadataUpdate?.app_metadata, {
      onboarded: false,
      role: "BUYER",
      has_seller_profile: false,
    });
    assert.equal(events.at(-1), "session:refresh");
  });

  it("overrides stale Supabase onboarded=false when Neon says the user is onboarded", async () => {
    supabaseAppMetadata = {
      onboarded: false,
      role: "BUYER",
      has_seller_profile: false,
    };
    seedAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assertSuccessfulRedirect(result, "/dashboard/buyer");
    assert.equal(lastSuccessfulMetadataUpdate?.app_metadata.onboarded, true);
    assert.equal(
      events.filter((event) => event === "session:refresh").length,
      1,
    );
  });

  it("still succeeds when refreshSession fails after a successful repair", async () => {
    seedAccount({ onboarded: true });
    refreshBehavior = { error: { message: "Too many requests" } };
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assertSuccessfulRedirect(result, "/dashboard/buyer");
    assert.ok(lastSuccessfulMetadataUpdate);
    assert.equal(events.at(-1), "session:refresh");
  });

  it("fails closed and clears the stale session when metadata synchronization fails", async () => {
    seedAccount({ onboarded: true });
    metadataSyncBehavior = { error: { message: "Admin API unavailable" } };
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assert.equal(result.success, false);
    assert.equal(lastMetadataAttempt?.app_metadata.onboarded, true);
    assert.equal(
      lastSuccessfulMetadataUpdate,
      null,
      "the failed update is not treated as repaired",
    );
    assert.ok(
      !events.includes("session:refresh"),
      "stale claims are not refreshed as if repaired",
    );
    assert.equal(
      events.at(-1),
      "session:sign-out",
      "the stale authenticated session is cleared",
    );
  });

  it("does not manufacture onboarding success when provisioning and lookup fail", async () => {
    provisionError = new Error("Neon unavailable during provision");
    lookupError = new Error("Neon unavailable during lookup");
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assert.equal(result.success, false);
    assert.equal(
      lastMetadataAttempt,
      null,
      "no metadata is written without authoritative state",
    );
    assert.ok(!events.includes("session:refresh"));
    assert.equal(events.at(-1), "session:sign-out");
  });

  it("honors only safe internal redirect targets after authoritative onboarding", async () => {
    seedAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    const internal = await signInAction(
      LOGIN,
      "/dashboard/buyer/orders?status=open",
    );
    assertSuccessfulRedirect(internal, "/dashboard/buyer/orders?status=open");

    const external = await signInAction(LOGIN, "//evil.example/steal-session");
    assertSuccessfulRedirect(external, "/dashboard/buyer");
  });
});
