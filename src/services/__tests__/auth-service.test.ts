import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  FakePrismaError,
  createFakeAccountStore,
  seedAccount,
  type FakeAccountStore,
} from "./helpers/fake-account-store";
import {
  createFakeSupabaseWorld,
  fakeSupabaseUser,
  type FakeSupabaseWorld,
} from "./helpers/fake-supabase";

/**
 * Behavior tests for the server-only wiring layer: classification at the
 * Neon and Supabase-Admin boundaries, bounded Neon retries, the read-merge
 * metadata sync, the single session-refresh boundary, and the shared
 * post-authentication settlement pipeline.
 *
 * The REAL auth-service + account-provisioning logic runs; only the process
 * boundaries (Prisma client, Supabase clients, server-only) are faked.
 */

const store: FakeAccountStore = createFakeAccountStore();
const world: FakeSupabaseWorld = createFakeSupabaseWorld();

mock.module("server-only", { namedExports: {} });
mock.module("next/navigation", { namedExports: { redirect: () => undefined } });
mock.module("next/headers", { namedExports: { headers: async () => new Map() } });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => world.createSessionClient(),
    createServiceRoleClient: () => world.createServiceRoleClient(),
  },
});

let service: typeof import("@/services/auth-service");
async function loadService() {
  service ??= await import("@/services/auth-service");
  return service;
}

/** The fixture's email as a plain string (the Neon `users.email` column is non-nullable). */
const USER_EMAIL = "emmanuel@example.com";
const USER = fakeSupabaseUser({ email: USER_EMAIL });

function reset() {
  store.tables.users.clear();
  store.tables.profiles.clear();
  store.tables.sellers.clear();
  store.statements.length = 0;
  store.resetFailures();
  world.reset();
}

beforeEach(reset);

/** Canonical state fixture. */
function canonicalState(overrides: Partial<import("@/services/account-provisioning").ApplicationAccountState> = {}) {
  return {
    userId: USER.id,
    exists: true,
    role: "BUYER" as const,
    onboarded: true,
    hasSellerProfile: false,
    profile: { fullName: "Emmanuel Yegon", avatarUrl: null, county: "Uasin Gishu" },
    ...overrides,
  };
}

describe("syncApplicationClaims", () => {
  it("mirrors exactly the three claims middleware needs — and preserves unrelated app_metadata keys (read-merge)", async () => {
    await loadService();
    world.users.set(USER.id, {
      ...USER,
      app_metadata: { legacy_claim: "keep-me", provider: "google" },
    });

    const state = await service.syncApplicationClaims(USER.id, canonicalState({ role: "SELLER", hasSellerProfile: true }));

    const written = world.lastAdminUpdate;
    assert.ok(written);
    assert.deepEqual(written.app_metadata, {
      legacy_claim: "keep-me",
      provider: "google",
      role: "SELLER",
      onboarded: true,
      has_seller_profile: true,
    });
    assert.deepEqual(state, canonicalState({ role: "SELLER", hasSellerProfile: true }));
    // Read once, write once.
    assert.equal(world.adminBehavior.getUserByIdCalls, 1);
    assert.equal(world.adminBehavior.updateUserByIdCalls, 1);
  });

  it("throws METADATA_SYNC_FAILED (with the HTTP status) when the Admin API rejects the write", async () => {
    await loadService();
    world.users.set(USER.id, USER);
    world.adminBehavior.updateUserByIdError = {
      name: "AuthApiError",
      status: 401,
      message: "invalid JWT",
    };

    await assert.rejects(
      () => service.syncApplicationClaims(USER.id, canonicalState()),
      (error: unknown) => {
        assert.ok(error instanceof service.AuthError);
        assert.equal(error.code, "METADATA_SYNC_FAILED");
        assert.equal(error.detail.httpStatus, 401);
        assert.equal(error.boundary, "supabase-admin");
        return true;
      },
    );
  });

  it("throws METADATA_SYNC_FAILED when the Admin API read fails (cannot safely merge)", async () => {
    await loadService();
    world.users.set(USER.id, USER);
    world.adminBehavior.getUserByIdError = {
      name: "AuthRetryableFetchException",
      message: "fetch failed",
    };

    await assert.rejects(
      () => service.syncApplicationClaims(USER.id, canonicalState()),
      (error: unknown) => error instanceof service.AuthError && error.code === "METADATA_SYNC_FAILED",
    );
    // No write is attempted when the read fails — nothing gets clobbered.
    assert.equal(world.adminBehavior.updateUserByIdCalls, 0);
  });

  it("fails closed when the Admin API result does not include the expected user", async () => {
    await loadService();
    world.users.set(USER.id, USER);
    world.adminBehavior.updateUserByIdWrongUser = true;

    await assert.rejects(
      () => service.syncApplicationClaims(USER.id, canonicalState()),
      (error: unknown) => error instanceof service.AuthError && error.code === "METADATA_SYNC_FAILED",
    );
  });

  it("classifies a missing service-role key as METADATA_SYNC_FAILED with a configuration reason", async () => {
    await loadService();
    world.serviceRoleKey = undefined;

    await assert.rejects(
      () => service.syncApplicationClaims(USER.id, canonicalState()),
      (error: unknown) => {
        assert.ok(error instanceof service.AuthError);
        assert.equal(error.code, "METADATA_SYNC_FAILED");
        assert.equal(error.detail.reason, "service-role-key-missing");
        return true;
      },
    );
  });
});

describe("ensureApplicationAccount (wired)", () => {
  it("provisions a fresh account and returns the canonical state", async () => {
    await loadService();
    const state = await service.ensureApplicationAccount(USER, "sign-in", undefined, 0);

    assert.equal(state.exists, true);
    assert.equal(state.onboarded, false);
    assert.equal(state.role, "BUYER");
    assert.ok(store.tables.users.has(USER.id));
    assert.ok(store.tables.profiles.has(USER.id));
  });

  it("retries once on a connection-class failure (Neon scale-to-zero), then succeeds", async () => {
    await loadService();
    store.enqueueFailures(new FakePrismaError("P1001", "Request timed out"), 1);

    const state = await service.ensureApplicationAccount(USER, "sign-in", undefined, 0);

    assert.equal(state.exists, true);
    // user.upsert was attempted twice (fail, then success).
    assert.equal(store.statements.filter((s) => s.startsWith("user.upsert")).length, 2);
  });

  it("emits AUTH_NEON_CONNECTION_RETRY on the same correlation id when the cold start self-heals", async () => {
    await loadService();
    store.enqueueFailures(new FakePrismaError("P1001", "Request timed out"), 1);

    // The suite is normally quiet; turn structured logging back on and
    // capture what an operator would see in the Render/Node log stream.
    process.env.AUTH_DEBUG = "1";
    const lines: Record<string, unknown>[] = [];
    const original = console.log;
    console.log = (line: string) => {
      try {
        lines.push(JSON.parse(line));
      } catch {
        /* ignore non-JSON */
      }
    };
    try {
      await service.ensureApplicationAccount(USER, "sign-in", undefined, 0);
    } finally {
      console.log = original;
      delete process.env.AUTH_DEBUG;
    }

    const retryLines = lines.filter((l) => l.event === "AUTH_NEON_CONNECTION_RETRY");
    assert.equal(retryLines.length, 1, "exactly one cold-start signal");
    assert.equal(retryLines[0]?.prismaCode, "P1001");

    // The retry is correlated to the SAME flow as the provision lines.
    const startLine = lines.find((l) => l.event === "AUTH_ACCOUNT_PROVISION_START");
    const provisionLine = lines.find((l) => l.event === "AUTH_ACCOUNT_PROVISION_SUCCESS");
    assert.ok(startLine && provisionLine, "provision start/success lines present");
    assert.equal(retryLines[0]?.correlationId, startLine?.correlationId);
    assert.equal(retryLines[0]?.correlationId, provisionLine?.correlationId);
  });

  it("fails with DATABASE_UNAVAILABLE when the database stays unavailable", async () => {
    await loadService();
    store.failAll(new FakePrismaError("P1001", "Request timed out"));

    await assert.rejects(
      () => service.ensureApplicationAccount(USER, "sign-in", undefined, 0),
      (error: unknown) => {
        assert.ok(error instanceof service.AuthError);
        assert.equal(error.code, "DATABASE_UNAVAILABLE");
        assert.equal(error.detail.prismaCode, "P1001");
        return true;
      },
    );
  });

  it("classifies a unique-constraint conflict as ACCOUNT_PROVISIONING_FAILED (not DATABASE_UNAVAILABLE)", async () => {
    await loadService();
    seedAccount(store, {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: USER_EMAIL,
    });

    await assert.rejects(
      () => service.ensureApplicationAccount(USER, "sign-in", undefined, 0),
      (error: unknown) => {
        assert.ok(error instanceof service.AuthError);
        assert.equal(error.code, "ACCOUNT_PROVISIONING_FAILED");
        assert.equal(error.detail.prismaCode, "P2002");
        return true;
      },
    );
  });

  it("classifies an identity without an email distinctly", async () => {
    await loadService();
    const noEmail = fakeSupabaseUser({ email: null, id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" });

    await assert.rejects(
      () => service.ensureApplicationAccount(noEmail, "sign-in", undefined, 0),
      (error: unknown) => {
        assert.ok(error instanceof service.AuthError);
        assert.equal(error.code, "ACCOUNT_PROVISIONING_FAILED");
        assert.match(error.detail.note ?? "", /identity-without-email/);
        return true;
      },
    );
  });
});

describe("getApplicationAccountState (wired)", () => {
  it("returns ACCOUNT_EXISTS for a seeded account", async () => {
    await loadService();
    seedAccount(store, { id: USER.id, email: USER_EMAIL, role: "SELLER", onboarded: true, seller: {} });

    const result = await service.getApplicationAccountState(USER.id);

    assert.equal(result.status, "EXISTS");
    assert.equal(result.state.role, "SELLER");
    assert.equal(result.state.onboarded, true);
    assert.equal(result.state.hasSellerProfile, true);
  });

  it("returns ACCOUNT_MISSING (a status, not an error) for an unknown account", async () => {
    await loadService();
    const result = await service.getApplicationAccountState("cccccccc-dddd-eeee-ffff-000000000000");

    assert.equal(result.status, "MISSING");
    assert.equal(result.state.exists, false);
    assert.equal(result.state.onboarded, false);
  });

  it("fails with DATABASE_UNAVAILABLE on a connection error — never converts to onboarded=false", async () => {
    await loadService();
    store.failAll(new FakePrismaError("P1002", "Can't reach database API"));

    await assert.rejects(
      () => service.getApplicationAccountState(USER.id),
      (error: unknown) => {
        assert.ok(error instanceof service.AuthError);
        assert.equal(error.code, "DATABASE_UNAVAILABLE");
        return true;
      },
    );
  });
});

describe("completeUserProfile (wired)", () => {
  const INPUT: import("@/lib/validations/auth").CompleteProfileInput = {
    fullName: "Emmanuel Yegon",
    phone: "+254726090372",
    county: "Uasin Gishu",
    accountIntent: "BOTH",
    avatarUrl: "",
  };

  it("commits the Neon write, then mirrors the claims (metadataSynced=true)", async () => {
    await loadService();
    world.users.set(USER.id, USER);

    const identity = service.authIdentityFromSupabaseUser(USER);
    const result = await service.completeUserProfile(identity, INPUT);

    assert.equal(result.state.onboarded, true);
    assert.equal(result.role, "SELLER");
    assert.equal(result.wantsToSell, true);
    assert.equal(result.metadataSynced, true);
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      role: "SELLER",
      onboarded: true,
      has_seller_profile: true,
    });
  });

  it("does NOT undo committed onboarding when the metadata sync fails (metadataSynced=false)", async () => {
    await loadService();
    world.users.set(USER.id, USER);
    world.adminBehavior.updateUserByIdError = {
      name: "AuthApiError",
      status: 503,
      message: "Service Unavailable",
    };

    const identity = service.authIdentityFromSupabaseUser(USER);
    const result = await service.completeUserProfile(identity, INPUT);

    // The Neon transaction committed — onboarding is REAL.
    assert.equal(result.state.onboarded, true);
    assert.equal(store.tables.profiles.get(USER.id)?.onboarded, true);
    assert.equal(result.metadataSynced, false);
  });

  it("propagates database failures (no onboarding claimed)", async () => {
    await loadService();
    store.failAll(new FakePrismaError("P1001", "Request timed out"));

    const identity = service.authIdentityFromSupabaseUser(USER);
    await assert.rejects(
      () => service.completeUserProfile(identity, INPUT),
      (error: unknown) => error instanceof FakePrismaError && error.code === "P1001",
    );
    assert.equal(store.tables.profiles.size, 0);
  });
});

describe("settleAuthenticatedAccount (the shared post-auth pipeline)", () => {
  it("runs ensure → admin read → admin write → exactly one session refresh, in that order", async () => {
    await loadService();
    seedAccount(store, { id: USER.id, email: USER_EMAIL, role: "BUYER", onboarded: true });
    world.users.set(USER.id, USER);
    world.sessionBehavior.getUser = USER;

    // Capture a single ordered timeline across both process boundaries.
    const timeline: string[] = [];
    const neonPush = store.statements.push.bind(store.statements);
    store.statements.push = (s: string) => {
      timeline.push(`neon:${s}`);
      return neonPush(s);
    };
    const worldPush = world.events.push.bind(world.events);
    world.events.push = (s: string) => {
      timeline.push(`supabase:${s}`);
      return worldPush(s);
    };

    const sessionClient = world.createSessionClient();
    const state = await service.settleAuthenticatedAccount({
      supabaseUser: USER,
      sessionClient,
      context: "sign-in",
    });

    assert.equal(state.onboarded, true);

    const order = timeline.filter((entry) =>
      [
        `neon:user.upsert:${USER.id}`,
        `neon:profile.upsert:${USER.id}`,
        `neon:seller.findUnique:${USER.id}`,
        `supabase:admin:get-user-by-id:${USER.id}`,
        `supabase:admin:update-user-by-id:${USER.id}`,
        "supabase:session:refresh",
      ].includes(entry),
    );

    assert.deepEqual(order, [
      `neon:user.upsert:${USER.id}`,
      `neon:profile.upsert:${USER.id}`,
      `neon:seller.findUnique:${USER.id}`,
      `supabase:admin:get-user-by-id:${USER.id}`,
      `supabase:admin:update-user-by-id:${USER.id}`,
      "supabase:session:refresh",
    ]);
    assert.equal(
      timeline.filter((entry) => entry === "supabase:session:refresh").length,
      1,
      "refreshSession is called exactly once",
    );
  });

  it("does NOT touch Supabase Admin or the session when Neon is down", async () => {
    await loadService();
    store.failAll(new FakePrismaError("P1001", "Request timed out"));
    world.users.set(USER.id, USER);
    world.sessionBehavior.getUser = USER;

    const sessionClient = world.createSessionClient();
    await assert.rejects(
      () =>
        service.settleAuthenticatedAccount({
          supabaseUser: USER,
          sessionClient,
          context: "sign-in",
          retryDelayMs: 0,
        }),
      (error: unknown) => error instanceof service.AuthError && error.code === "DATABASE_UNAVAILABLE",
    );

    assert.equal(world.adminBehavior.getUserByIdCalls, 0);
    assert.equal(world.adminBehavior.updateUserByIdCalls, 0);
    assert.equal(world.sessionBehavior.refreshCalls, 0);
  });

  it("does NOT refresh the session when the metadata sync fails", async () => {
    await loadService();
    seedAccount(store, { id: USER.id, email: USER_EMAIL, onboarded: true });
    world.users.set(USER.id, USER);
    world.adminBehavior.updateUserByIdError = {
      name: "AuthApiError",
      status: 401,
      message: "invalid JWT",
    };
    world.sessionBehavior.getUser = USER;

    const sessionClient = world.createSessionClient();
    await assert.rejects(
      () =>
        service.settleAuthenticatedAccount({
          supabaseUser: USER,
          sessionClient,
          context: "sign-in",
        }),
      (error: unknown) => error instanceof service.AuthError && error.code === "METADATA_SYNC_FAILED",
    );

    assert.equal(world.sessionBehavior.refreshCalls, 0, "stale claims are never refreshed as if repaired");
  });

  it("returns the state even when the refresh fails (defined, loop-free behavior)", async () => {
    await loadService();
    seedAccount(store, { id: USER.id, email: USER_EMAIL, onboarded: true });
    world.users.set(USER.id, USER);
    world.sessionBehavior.getUser = USER;
    world.sessionBehavior.refreshError = { message: "Too many requests" };

    const sessionClient = world.createSessionClient();
    const state = await service.settleAuthenticatedAccount({
      supabaseUser: USER,
      sessionClient,
      context: "sign-in",
    });

    assert.equal(state.onboarded, true);
    assert.equal(world.sessionBehavior.refreshCalls, 1, "the refresh was attempted exactly once");
  });
});

describe("provisionUserRows (best-effort sign-up provisioning)", () => {
  it("provisions real new identities and swallows (logs) failures", async () => {
    await loadService();
    await service.provisionUserRows(USER, "sign-up");
    assert.ok(store.tables.users.has(USER.id));

    store.failAll(new FakePrismaError("P1001", "timeout"));
    await assert.doesNotReject(() =>
      service.provisionUserRows(fakeSupabaseUser({ id: "dddddddd-eeee-ffff-0000-111111111111" }), "sign-up"),
    );
  });
});
