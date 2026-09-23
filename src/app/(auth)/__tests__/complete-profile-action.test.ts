import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ApiResult } from "@/types";
import type { CompleteProfileInput } from "@/lib/validations/auth";

/**
 * Regression test for the post-onboarding redirect loop.
 *
 * Root cause: `completeUserProfile()` commits the Neon transaction and mirrors
 * `onboarded: true` into Supabase's `app_metadata` (server-side), but the JWT
 * in the browser's auth cookie keeps its pre-onboarding claims until the
 * session is refreshed. Middleware evaluates its onboarding check from that
 * stale session and bounced the freshly onboarded user from
 * `/dashboard/*` straight back to `/complete-profile`.
 *
 * The fix: `completeProfileAction()` must refresh the Supabase session on the
 * same per-request server client it already authenticated the user with —
 * AFTER the profile operation succeeds and BEFORE it returns the dashboard
 * redirect.
 *
 * These tests run the REAL action → auth-service → account-provisioning chain
 * against fakes for the process boundaries the repo keeps untestable by
 * design (Prisma client, Supabase clients, Next.js request scope — the same
 * seams documented in src/services/account-provisioning.ts). An ordered event
 * log pins the exact call order; no network, database, cookies, or Supabase
 * project are involved.
 *
 * Module mocking requires Node's built-in `--experimental-test-module-mocks`
 * (enabled on the `test` script) — the node:test equivalent of the module
 * mocks a Vitest setup would provide.
 */

// ─── Fakes ──────────────────────────────────────────────────────────────────

/** Ordered record of every boundary crossing the action makes. */
const events: string[] = [];

const SUPABASE_USER_ID = "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";

/** What `supabase.auth.getUser()` returns BEFORE onboarding: no `onboarded`
 * claim anywhere — exactly the pre-fix session state. */
const SUPABASE_USER = {
  id: SUPABASE_USER_ID,
  email: "emmanuel@example.com",
  phone: null,
  email_confirmed_at: "2026-09-20T08:15:00.000Z",
  app_metadata: {},
  user_metadata: { full_name: "Emmanuel Yegon" },
};

type UserRow = {
  id: string;
  email: string;
  phone: string | null;
  role: string;
  emailVerified: boolean;
};

type ProfileRow = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  county: string | null;
  onboarded: boolean;
};

type SellerRow = {
  userId: string;
  businessName: string;
  slug: string;
  county: string | null;
};

/** Minimal in-memory mirror of the tables `saveCompletedProfile` touches. */
const db = {
  users: new Map<string, UserRow>(),
  profiles: new Map<string, ProfileRow>(),
  sellers: new Map<string, SellerRow>(),
};

/** Last payload mirrored into Supabase app_metadata by the service-role client. */
let lastAppMetadataUpdate: { userId: string; app_metadata: Record<string, unknown> } | null = null;

/** Injects failure modes into the fake `refreshSession()`. */
let refreshSessionBehavior: { error?: { message: string }; throw?: Error } = {};

/** Minimal stand-in for `PrismaClient` that satisfies `saveCompletedProfile`. */
type FakePrisma = {
  user: {
    upsert(args: { where: { id: string }; create: UserRow }): Promise<UserRow>;
    update(args: { where: { id: string }; data: Partial<UserRow> }): Promise<UserRow>;
    findFirst(args: {
      where: { phone: string; NOT?: { id: string } };
    }): Promise<{ id: string } | null>;
  };
  profile: {
    upsert(args: { where: { userId: string }; create: ProfileRow }): Promise<ProfileRow>;
    update(args: { where: { userId: string }; data: Partial<ProfileRow> }): Promise<ProfileRow>;
  };
  seller: {
    findUnique(args: { where: { userId: string } }): Promise<SellerRow | null>;
    create(args: { data: SellerRow }): Promise<SellerRow>;
  };
  $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T>;
};

const fakePrisma: FakePrisma = {
  user: {
    async upsert({ where, create }) {
      const row = { ...db.users.get(where.id), ...create, id: where.id } as UserRow;
      db.users.set(where.id, row);
      return row;
    },
    async update({ where, data }) {
      const existing = db.users.get(where.id);
      if (!existing) throw Object.assign(new Error("row not found"), { code: "P2025" });
      const row = { ...existing, ...data };
      db.users.set(where.id, row);
      return row;
    },
    async findFirst({ where }) {
      for (const row of db.users.values()) {
        if (row.phone === where.phone && row.id !== where.NOT?.id) return { id: row.id };
      }
      return null;
    },
  },
  profile: {
    async upsert({ where, create }) {
      const row = { ...db.profiles.get(where.userId), ...create, userId: where.userId } as ProfileRow;
      db.profiles.set(where.userId, row);
      return row;
    },
    async update({ where, data }) {
      const existing = db.profiles.get(where.userId);
      if (!existing) throw Object.assign(new Error("row not found"), { code: "P2025" });
      const row = { ...existing, ...data };
      db.profiles.set(where.userId, row);
      return row;
    },
  },
  seller: {
    async findUnique({ where }) {
      return db.sellers.get(where.userId) ?? null;
    },
    async create({ data }) {
      db.sellers.set(data.userId, { ...data });
      return { ...data };
    },
  },
  async $transaction(fn) {
    events.push("profile:transaction");
    return fn(fakePrisma);
  },
};

/**
 * The per-request Supabase client the action itself creates (the client the
 * fix must call `refreshSession()` on — NOT the service-role client, which
 * `completeUserProfile` uses for the app_metadata mirror).
 */
const fakeSessionClient = {
  auth: {
    async getUser() {
      events.push("session:get-user");
      return { data: { user: SUPABASE_USER }, error: null };
    },
    async refreshSession() {
      events.push("session:refresh");
      if (refreshSessionBehavior.throw) throw refreshSessionBehavior.throw;
      return {
        data: { session: null, user: SUPABASE_USER },
        error: refreshSessionBehavior.error ?? null,
      };
    },
  },
};

const fakeServiceRoleClient = {
  auth: {
    admin: {
      async updateUserById(userId: string, attributes: { app_metadata: Record<string, unknown> }) {
        events.push("app_metadata:update");
        lastAppMetadataUpdate = { userId, app_metadata: attributes.app_metadata };
        return { data: { user: SUPABASE_USER }, error: null };
      },
    },
  },
};

// ─── Module mocks (registered before the action module is imported) ─────────
// `server-only`, `next/navigation` and `next/headers` are compile/bundle-time
// boundaries the plain Node test process must not evaluate; the Prisma and
// Supabase clients are faked at their import sites so the REAL service code
// runs against them.

mock.module("server-only", { namedExports: {} });
mock.module("next/navigation", { namedExports: { redirect: () => undefined } });
mock.module("next/headers", { namedExports: { headers: async () => new Map() } });
mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => fakeSessionClient,
    createServiceRoleClient: () => fakeServiceRoleClient,
  },
});

/** Imports the action module once, after the mocks above are registered. */
let actionModule: typeof import("@/app/(auth)/actions") | null = null;
async function loadAction() {
  actionModule ??= await import("@/app/(auth)/actions");
  return actionModule;
}

/** Account intent is deliberately excluded: every test spells out which
 * dashboard the user chose, since that's what the redirect assertions check. */
const BASE_INPUT: Omit<CompleteProfileInput, "accountIntent"> = {
  fullName: "Emmanuel Yegon",
  phone: "+254726090372",
  county: "Uasin Gishu",
  avatarUrl: "",
};

function resetFakes() {
  events.length = 0;
  db.users.clear();
  db.profiles.clear();
  db.sellers.clear();
  lastAppMetadataUpdate = null;
  refreshSessionBehavior = {};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("completeProfileAction — post-onboarding session refresh (redirect-loop regression)", () => {
  beforeEach(resetFakes);

  it("authenticates the user, completes the profile, refreshes the session, then redirects to the buyer dashboard", async () => {
    const { completeProfileAction } = await loadAction();

    const result: ApiResult<{ redirectTo: string }> = await completeProfileAction({
      ...BASE_INPUT,
      accountIntent: "BUYER",
    });

    // (A) the action ran against the authenticated Supabase user…
    assert.ok(events.includes("session:get-user"), "the action authenticated the user first");
    const provisioned = db.users.get(SUPABASE_USER_ID);
    assert.ok(provisioned, "the profile write used the Supabase user's id");
    assert.equal(provisioned.email, "emmanuel@example.com");

    // (B) …the profile operation succeeded…
    assert.equal(db.profiles.get(SUPABASE_USER_ID)?.onboarded, true);

    // (C) …the session was refreshed on the user-facing client…
    assert.equal(events.filter((e) => e === "session:refresh").length, 1, "refreshSession called exactly once");

    // …AFTER the Neon transaction AND after the app_metadata sync, and the
    // action only returned success once all of that had happened (the result
    // below only exists after the awaited refresh resolved).
    const transactionAt = events.indexOf("profile:transaction");
    const metadataAt = events.indexOf("app_metadata:update");
    const refreshAt = events.indexOf("session:refresh");
    assert.ok(transactionAt >= 0, "the profile transaction ran");
    assert.ok(metadataAt > transactionAt, "app_metadata sync happened after the transaction");
    assert.ok(refreshAt > metadataAt, "session refresh happened after the profile completion");
    // The refresh is the action's last boundary crossing: the dashboard
    // redirect below is only returned once the refreshed session is in place.
    assert.equal(refreshAt, events.length - 1, "nothing runs between the refresh and the action returning");

    // (D) the result is successful…
    assert.equal(result.success, true);

    // (E) …and points at the buyer dashboard (redirect destinations unchanged).
    assert.equal(result.success && result.data.redirectTo, "/dashboard/buyer");

    // The app_metadata mirror itself (the claim the refreshed JWT must carry).
    assert.deepEqual(lastAppMetadataUpdate, {
      userId: SUPABASE_USER_ID,
      app_metadata: { role: "BUYER", has_seller_profile: false, onboarded: true },
    });
  });

  it("redirects to the seller dashboard for accountIntent SELLER, refreshing first", async () => {
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...BASE_INPUT, accountIntent: "SELLER" });

    assert.equal(result.success, true);
    assert.equal(result.success && result.data.redirectTo, "/dashboard/seller");

    const metadataAt = events.indexOf("app_metadata:update");
    const refreshAt = events.indexOf("session:refresh");
    assert.ok(metadataAt >= 0 && refreshAt > metadataAt, "session refreshed after profile completion");
    assert.deepEqual(lastAppMetadataUpdate?.app_metadata, {
      role: "SELLER",
      has_seller_profile: true,
      onboarded: true,
    });
    assert.ok(db.sellers.get(SUPABASE_USER_ID), "a starter Seller row exists");
  });

  it("redirects to the seller dashboard for accountIntent BOTH (sells and buys)", async () => {
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...BASE_INPUT, accountIntent: "BOTH" });

    assert.equal(result.success, true);
    assert.equal(result.success && result.data.redirectTo, "/dashboard/seller");
    assert.ok(db.sellers.get(SUPABASE_USER_ID));
    assert.equal(events.indexOf("session:refresh") > events.indexOf("profile:transaction"), true);
  });

  it("still succeeds when the session refresh reports an error — a failed refresh must not undo completed onboarding", async () => {
    refreshSessionBehavior = { error: { message: "Too many requests" } };
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...BASE_INPUT, accountIntent: "BUYER" });

    assert.ok(events.includes("session:refresh"), "the refresh was still attempted");
    assert.equal(result.success, true, "the successful profile transaction is not turned into a failure");
    assert.equal(result.success && result.data.redirectTo, "/dashboard/buyer");
    assert.equal(db.profiles.get(SUPABASE_USER_ID)?.onboarded, true);
  });

  it("still succeeds when the session refresh throws unexpectedly", async () => {
    refreshSessionBehavior = { throw: new Error("storage write failed") };
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...BASE_INPUT, accountIntent: "BUYER" });

    assert.equal(result.success, true);
    assert.equal(result.success && result.data.redirectTo, "/dashboard/buyer");
  });

  it("does NOT refresh the session when the profile write fails", async () => {
    // Another account already claimed this phone number → AuthServiceError.
    db.users.set("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: "other@example.com",
      phone: BASE_INPUT.phone,
      role: "BUYER",
      emailVerified: true,
    });
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...BASE_INPUT, accountIntent: "BUYER" });

    assert.equal(result.success, false);
    assert.ok(events.includes("profile:transaction"), "the (rolled-back) transaction was attempted");
    assert.ok(!events.includes("app_metadata:update"), "app_metadata was never synced");
    assert.ok(!events.includes("session:refresh"), "no session refresh after a failed profile write");
  });
});
