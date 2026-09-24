import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { ApiResult } from "@/types";
import {
  FakePrismaError,
  createFakeAccountStore,
  seedAccount,
  type FakeAccountStore,
} from "@/services/__tests__/helpers/fake-account-store";
import {
  createFakeSupabaseWorld,
  fakeSupabaseUser,
  type FakeSupabaseWorld,
} from "@/services/__tests__/helpers/fake-supabase";

/**
 * Behavior tests for email sign-in — the real
 * signInAction → auth-service → account-provisioning chain runs against
 * fakes for the process boundaries only (Prisma, Supabase, Next request
 * scope). No network, credentials, or production database is involved.
 *
 * The scenarios map to the audit's required behavior matrix:
 *  1  existing onboarded BUYER (empty metadata)
 *  2  existing onboarded SELLER
 *  3  incomplete user
 *  4  stale metadata (Supabase false / Neon true)
 *  5  missing metadata ({})
 *  6  missing Neon account
 *  7  Neon database failure
 *  8  Supabase Admin metadata failure
 *  9  session refresh failure
 *  10 invalid redirect
 *  11 ADMIN preserved
 *  12 SUPER_ADMIN preserved
 *  13 seller cannot be downgraded
 *  +  the production failure, reproduced branch by branch (§22)
 */

const store: FakeAccountStore = createFakeAccountStore();
const world: FakeSupabaseWorld = createFakeSupabaseWorld();

mock.module("server-only", { namedExports: {} });
mock.module("next/navigation", { namedExports: { redirect: () => undefined } });
mock.module("next/headers", {
  namedExports: { headers: async () => new Map() },
});
mock.module("@/lib/prisma", { namedExports: { prisma: store } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => world.createSessionClient(),
    createServiceRoleClient: () => world.createServiceRoleClient(),
  },
});

let actions: typeof import("@/app/(auth)/actions");
async function loadActions() {
  actions ??= await import("@/app/(auth)/actions");
  return actions;
}

const USER_ID = "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";
const LOGIN = { email: "emmanuel@example.com", password: "Password1" };

function signInUser(overrides: Parameters<typeof fakeSupabaseUser>[0] = {}) {
  const user = fakeSupabaseUser({ id: USER_ID, email: LOGIN.email, ...overrides });
  world.sessionBehavior.signInWithPasswordUser = user;
  world.users.set(USER_ID, { ...user });
  return user;
}

function reset() {
  store.tables.users.clear();
  store.tables.profiles.clear();
  store.tables.sellers.clear();
  store.statements.length = 0;
  store.resetFailures();
  world.reset();
}

beforeEach(reset);

function assertRedirect(result: ApiResult<{ redirectTo: string }>, expected: string, message?: string) {
  assert.equal(result.success, true, message ?? `expected success, got ${JSON.stringify(result)}`);
  if (result.success) assert.equal(result.data.redirectTo, expected, message);
}

function assertFailure(result: ApiResult<{ redirectTo: string }>, expectedMessage: string) {
  assert.equal(result.success, false, `expected failure, got ${JSON.stringify(result)}`);
  if (!result.success) assert.equal(result.error, expectedMessage);
}

describe("signInAction — happy paths route from authoritative Neon state", () => {
  it("1. existing onboarded BUYER with empty metadata → /dashboard/buyer, metadata repaired, one refresh", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser({ app_metadata: {} });

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/buyer");
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      onboarded: true,
      role: "BUYER",
      has_seller_profile: false,
    });
    assert.equal(world.events.filter((e) => e === "session:refresh").length, 1);
    // Exactly one provisioning transaction, no follow-up duplicate lookup.
    assert.deepEqual(store.statements, [
      `user.upsert:${USER_ID}`,
      `profile.upsert:${USER_ID}`,
      `seller.findUnique:${USER_ID}`,
    ]);
  });

  it("2. existing onboarded SELLER → /dashboard/seller", async () => {
    await loadActions();
    seedAccount(store, {
      id: USER_ID,
      email: LOGIN.email,
      role: "SELLER",
      onboarded: true,
      seller: { businessName: "Yegon Electronics" },
    });
    signInUser();

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/seller");
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      onboarded: true,
      role: "SELLER",
      has_seller_profile: true,
    });
  });

  it("3. incomplete user (onboarded=false in Neon) → /complete-profile", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: false });
    signInUser();

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/complete-profile");
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      onboarded: false,
      role: "BUYER",
      has_seller_profile: false,
    });
  });

  it("4. stale Supabase metadata (onboarded=false) with Neon onboarded=true → repaired, refreshed, dashboard", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser({
      app_metadata: { onboarded: false, role: "BUYER", has_seller_profile: false },
    });

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/buyer");
    assert.equal(world.lastAdminUpdate?.app_metadata.onboarded, true, "Neon overrode the stale claim");
    assert.equal(world.events.filter((e) => e === "session:refresh").length, 1);
  });

  it("5. missing metadata ({}) for an onboarded account → repaired, dashboard", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "SELLER", onboarded: true, seller: {} });
    signInUser({ app_metadata: {} });

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/seller");
    assert.equal(world.lastAdminUpdate?.app_metadata.onboarded, true);
  });

  it("6. missing Neon account → provisioned safely, incomplete → /complete-profile", async () => {
    await loadActions();
    signInUser();

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/complete-profile");
    assert.ok(store.tables.users.has(USER_ID), "the users row was created");
    assert.ok(store.tables.profiles.has(USER_ID), "the profiles row was created");
    assert.equal(store.tables.users.get(USER_ID)?.role, "BUYER", "no role was granted");
    assert.equal(world.lastAdminUpdate?.app_metadata.onboarded, false, "no false onboarding");
  });

  it("11. existing ADMIN stays ADMIN (metadata mirrors it, never altered)", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "ADMIN", onboarded: true });
    signInUser({ app_metadata: { role: "BUYER", onboarded: false } });

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/buyer");
    assert.equal(world.lastAdminUpdate?.app_metadata.role, "ADMIN");
    assert.equal(store.tables.users.get(USER_ID)?.role, "ADMIN");
  });

  it("12. existing SUPER_ADMIN stays SUPER_ADMIN", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "SUPER_ADMIN", onboarded: true });
    signInUser();

    const result = await actions.signInAction(LOGIN);

    assert.equal(world.lastAdminUpdate?.app_metadata.role, "SUPER_ADMIN");
    assert.equal(store.tables.users.get(USER_ID)?.role, "SUPER_ADMIN");
    assertRedirect(result, "/dashboard/buyer");
  });

  it("13. an existing SELLER with stale BUYER metadata is NOT downgraded", async () => {
    await loadActions();
    seedAccount(store, {
      id: USER_ID,
      email: LOGIN.email,
      role: "SELLER",
      onboarded: true,
      seller: { businessName: "Yegon Electronics" },
    });
    signInUser({ app_metadata: { role: "BUYER", onboarded: true, has_seller_profile: false } });

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/seller");
    assert.equal(world.lastAdminUpdate?.app_metadata.role, "SELLER");
    assert.equal(world.lastAdminUpdate?.app_metadata.has_seller_profile, true);
  });

  it("preserves unrelated app_metadata keys when repairing (read-merge)", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser({ app_metadata: { legacy_claim: "keep-me" } });

    await actions.signInAction(LOGIN);

    assert.equal(world.lastAdminUpdate?.app_metadata.legacy_claim, "keep-me");
    assert.equal(world.lastAdminUpdate?.app_metadata.onboarded, true);
  });

  it("9a. still succeeds when refreshSession reports an error (no redirect loop possible)", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser();
    world.sessionBehavior.refreshError = { message: "Too many requests" };

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/buyer");
    assert.ok(world.lastAdminUpdate, "the metadata repair happened");
    assert.equal(world.sessionBehavior.refreshCalls, 1);
  });

  it("9b. still succeeds when refreshSession throws unexpectedly", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser();
    world.sessionBehavior.refreshThrow = new Error("storage write failed");

    const result = await actions.signInAction(LOGIN);

    assertRedirect(result, "/dashboard/buyer");
  });

  it("10. invalid redirect targets fall back to the safe dashboard; internal targets are honored", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser();

    for (const hostile of [
      "//evil.example/steal",
      "https://evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
    ]) {
      const result = await actions.signInAction(LOGIN, hostile);
      assertRedirect(result, "/dashboard/buyer", `for ${hostile}`);
    }

    const internal = await actions.signInAction(LOGIN, "/dashboard/buyer/orders?status=open");
    assertRedirect(internal, "/dashboard/buyer/orders?status=open");
  });

  it("10b. an incomplete user ignores redirectTo entirely (always /complete-profile)", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, onboarded: false });
    signInUser();

    const result = await actions.signInAction(LOGIN, "/dashboard/buyer");
    assertRedirect(result, "/complete-profile");
  });
});

describe("signInAction — authentication failures (Supabase boundary)", () => {
  it("maps invalid credentials to the friendly copy and provisions nothing", async () => {
    await loadActions();
    world.sessionBehavior.signInWithPasswordError = {
      name: "AuthApiError",
      status: 400,
      message: "Invalid login credentials",
    };

    const result = await actions.signInAction(LOGIN);

    assertFailure(result, "That email or password doesn't look right.");
    assert.equal(store.statements.length, 0, "no Neon work on a failed credential");
    assert.equal(world.adminBehavior.updateUserByIdCalls, 0);
    assert.equal(world.sessionBehavior.signOutCalls, 0, "no session existed to clear");
  });

  it("maps 'Email not confirmed' to its own copy", async () => {
    await loadActions();
    world.sessionBehavior.signInWithPasswordError = {
      name: "AuthApiError",
      status: 422,
      message: "Email not confirmed",
    };

    const result = await actions.signInAction(LOGIN);

    assertFailure(result, "Please verify your email before signing in — check your inbox.");
  });

  it("maps a Supabase outage (network) to 'temporarily unavailable', NOT to bad credentials", async () => {
    await loadActions();
    world.sessionBehavior.signInWithPasswordError = {
      name: "AuthRetryableFetchException",
      message: "fetch failed",
    };

    const result = await actions.signInAction(LOGIN);

    assertFailure(result, "Sign-in is temporarily unavailable. Please try again in a minute.");
  });

  it("maps rate limiting to its own copy", async () => {
    await loadActions();
    world.sessionBehavior.signInWithPasswordError = {
      name: "AuthApiError",
      status: 429,
      message: "Rate limit exceeded",
    };

    const result = await actions.signInAction(LOGIN);

    assertFailure(result, "Too many attempts. Please wait a moment and try again.");
  });
});

describe("signInAction — the production failure, reproduced branch by branch", () => {
  /**
   * The production error "We couldn't load your MaliHub account…" came from
   * the single fail-closed branch in signInAction that fired whenever the
   * post-auth settlement threw. It lumped distinct infrastructure failures
   * into one message with no diagnostics. Each branch is now:
   *
   *   - classified (one code per failure),
   *   - logged with the real cause (boundary + error code),
   *   - returned to the UI as a DISTINCT safe message,
   *   - fail-closed (the stale session is cleared, no false onboarding,
   *     no session refresh of unverified claims).
   */

  it("branch A: Neon unavailable (P1001) → DATABASE_UNAVAILABLE, session cleared, no metadata written", async () => {
    await loadActions();
    signInUser();
    store.failAll(new FakePrismaError("P1001", "Request timed out"));

    const result = await actions.signInAction(LOGIN);

    assertFailure(
      result,
      "MaliHub's account service is temporarily unavailable. Please try again in a minute.",
    );
    // The failing boundary was Neon — and only Neon.
    assert.equal(store.statements.filter((s) => s === "$transaction:rollback").length, 2, "ensure was attempted twice (bounded retry)");
    assert.equal(world.adminBehavior.getUserByIdCalls, 0, "Supabase Admin was never touched");
    assert.equal(world.adminBehavior.updateUserByIdCalls, 0);
    assert.equal(world.sessionBehavior.refreshCalls, 0, "unverified claims are never refreshed");
    assert.equal(world.sessionBehavior.signOutCalls, 1, "the authenticated session is cleared (fail closed)");
  });

  it("branch B: Supabase Admin rejects the metadata write (401) → METADATA_SYNC_FAILED, session cleared", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser();
    world.adminBehavior.updateUserByIdError = {
      name: "AuthApiError",
      status: 401,
      message: "invalid JWT",
    };

    const result = await actions.signInAction(LOGIN);

    assertFailure(
      result,
      "We couldn't fully load your MaliHub account. Please try signing in again in a moment.",
    );
    // Neon was fine (the account state is known) — the failure was the
    // Supabase Admin mirror.
    assert.ok(store.statements.length > 0, "Neon provisioning/lookup succeeded");
    assert.equal(world.adminBehavior.updateUserByIdCalls, 1, "the failing boundary was the Admin write");
    assert.equal(world.sessionBehavior.refreshCalls, 0);
    assert.equal(world.sessionBehavior.signOutCalls, 1);
  });

  it("branch C: service-role key missing in the environment → METADATA_SYNC_FAILED with a configuration reason (the leading production suspect)", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "BUYER", onboarded: true });
    signInUser();
    world.serviceRoleKey = undefined;

    const result = await actions.signInAction(LOGIN);

    assertFailure(
      result,
      "We couldn't fully load your MaliHub account. Please try signing in again in a moment.",
    );
    assert.equal(world.adminBehavior.updateUserByIdCalls, 0, "no Admin call is even attempted");
    assert.equal(world.sessionBehavior.signOutCalls, 1);
    assert.equal(world.sessionBehavior.refreshCalls, 0);
  });

  it("branch D: Neon answers with a schema-level error (P2022) during provisioning → provisioning classification, NOT retried, session cleared", async () => {
    await loadActions();
    signInUser();
    // P20xx request-class errors are NOT retried (the database answered).
    store.failAll(new FakePrismaError("P2022", "column \"profiles.onboarded\" does not exist"));

    const result = await actions.signInAction(LOGIN);

    // The failure happened while PREPARING the account — a different class
    // (and a different user-facing sentence) from a lookup or a sync failure.
    assertFailure(
      result,
      "We couldn't prepare your MaliHub account. Please try signing in again in a moment.",
    );
    // Request-class errors are not connection outages: no retry.
    assert.equal(store.statements.filter((s) => s === "$transaction:rollback").length, 1);
    assert.equal(world.adminBehavior.updateUserByIdCalls, 0);
    assert.equal(world.sessionBehavior.signOutCalls, 1);
  });

  it("never manufactures onboarding: a failed settlement never writes onboarded=true to Supabase", async () => {
    await loadActions();
    signInUser();
    store.failAll(new FakePrismaError("P1002", "Can't reach database API"));

    await actions.signInAction(LOGIN);

    assert.equal(world.lastAdminUpdate, null, "no app_metadata was written at all");
  });

  it("the UI messages for distinct failures are distinct (operators and users can tell them apart)", async () => {
    await loadActions();
    const messages: string[] = [];

    signInUser();
    store.failAll(new FakePrismaError("P1001", "timeout"));
    const dbResult = await actions.signInAction(LOGIN);
    messages.push(dbResult.success ? "" : dbResult.error);

    reset();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, onboarded: true });
    signInUser();
    world.adminBehavior.updateUserByIdError = { name: "AuthApiError", status: 401, message: "x" };
    const adminResult = await actions.signInAction(LOGIN);
    messages.push(adminResult.success ? "" : adminResult.error);

    reset();
    world.sessionBehavior.signInWithPasswordError = { name: "AuthApiError", status: 400, message: "Invalid login credentials" };
    const credsResult = await actions.signInAction(LOGIN);
    messages.push(credsResult.success ? "" : credsResult.error);

    assert.deepEqual(messages, [
      "MaliHub's account service is temporarily unavailable. Please try again in a minute.",
      "We couldn't fully load your MaliHub account. Please try signing in again in a moment.",
      "That email or password doesn't look right.",
    ]);
  });
});

describe("signInAction — ordering invariants", () => {
  it("the successful result is produced only after: one ensure txn → one admin read → one admin write → one refresh", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: LOGIN.email, role: "SELLER", onboarded: true, seller: {} });
    signInUser();

    await actions.signInAction(LOGIN);

    assert.equal(store.statements.filter((s) => s.startsWith("user.upsert")).length, 1, "no duplicate provisioning");
    assert.equal(store.statements.filter((s) => s === "$transaction:rollback").length, 0);
    assert.equal(world.adminBehavior.getUserByIdCalls, 1, "one admin read (for the read-merge)");
    assert.equal(world.adminBehavior.updateUserByIdCalls, 1, "one admin write");
    assert.equal(world.sessionBehavior.refreshCalls, 1, "one refresh");
    const lastEvent = world.events[world.events.length - 1];
    assert.equal(lastEvent, "session:refresh", "the refresh is the last boundary crossing before the result");
  });
});
