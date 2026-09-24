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
import type { CompleteProfileInput } from "@/lib/validations/auth";

/**
 * Behavior tests for /complete-profile submission — the loop breaker.
 *
 * The production redirect loop happened because the JWT (app_metadata) was
 * refreshed/checked BEFORE the Neon transaction committed, and the
 * destination came from the request payload instead of Neon truth. The
 * contract pinned here:
 *
 *   authenticated session → validate → NEON TX COMMITS FIRST
 *     → best-effort app_metadata sync → ONE session refresh
 *     → destination from the COMMITTED canonical state
 *
 * so that a stale JWT can never route the user back to /complete-profile
 * and no dashboard is entered before the database says onboarding is done.
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

function input(overrides: Partial<CompleteProfileInput> = {}): CompleteProfileInput {
  return {
    fullName: "Emmanuel Yegon",
    phone: "0712345678",
    county: "Nairobi",
    accountIntent: "BUYER",
    ...overrides,
  };
}

function actingUser(overrides: Parameters<typeof fakeSupabaseUser>[0] = {}) {
  const user = fakeSupabaseUser({
    id: USER_ID,
    email: "emmanuel@example.com",
    // The session may carry STALE claims — that is exactly the loop case.
    app_metadata: { onboarded: false, role: "BUYER", has_seller_profile: false },
    ...overrides,
  });
  world.sessionBehavior.getUser = user;
  world.users.set(USER_ID, user);
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

describe("completeProfileAction — the committed-state contract", () => {
  it("BUYER happy path: commits onboarding, syncs claims, refreshes once, → /dashboard/buyer", async () => {
    await loadActions();
    actingUser();
    // No Neon rows at all — first-ever save must provision inside the tx.

    const result = await actions.completeProfileAction(input());

    assertRedirect(result, "/dashboard/buyer");
    assert.equal(store.tables.users.get(USER_ID)?.phone, "0712345678");
    assert.equal(store.tables.profiles.get(USER_ID)?.onboarded, true);
    assert.equal(store.tables.profiles.get(USER_ID)?.fullName, "Emmanuel Yegon");
    assert.equal(store.tables.sellers.size, 0, "BUYER gets no Seller row");
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      onboarded: true,
      role: "BUYER",
      has_seller_profile: false,
    });
    assert.equal(world.sessionBehavior.refreshCalls, 1, "exactly one session refresh");
    assert.equal(world.sessionBehavior.signOutCalls, 0);
  });

  it("SELLER intent: commits SELLER + starter Seller row, → /dashboard/seller", async () => {
    await loadActions();
    actingUser();

    const result = await actions.completeProfileAction(input({ accountIntent: "SELLER" }));

    assertRedirect(result, "/dashboard/seller");
    assert.equal(store.tables.users.get(USER_ID)?.role, "SELLER");
    assert.ok(store.tables.sellers.has(USER_ID), "starter Seller row created");
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      onboarded: true,
      role: "SELLER",
      has_seller_profile: true,
    });
  });

  it("BOTH intent: sells AND buys → seller dashboard with a Seller row", async () => {
    await loadActions();
    actingUser();

    const result = await actions.completeProfileAction(input({ accountIntent: "BOTH" }));

    assertRedirect(result, "/dashboard/seller");
    assert.equal(store.tables.users.get(USER_ID)?.role, "SELLER");
    assert.ok(store.tables.sellers.has(USER_ID));
  });

  it("an existing SELLER who re-runs onboarding as BUYER is NOT downgraded", async () => {
    await loadActions();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "SELLER",
      onboarded: true,
      seller: { businessName: "Yegon Electronics" },
    });
    actingUser({ app_metadata: { onboarded: true, role: "SELLER", has_seller_profile: true } });

    const result = await actions.completeProfileAction(input({ accountIntent: "BUYER" }));

    assertRedirect(result, "/dashboard/seller");
    assert.equal(store.tables.users.get(USER_ID)?.role, "SELLER");
    assert.equal(world.lastAdminUpdate?.app_metadata.role, "SELLER");
  });

  it("an existing ADMIN is preserved even when the form asks to sell", async () => {
    await loadActions();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "ADMIN",
      onboarded: false,
    });
    actingUser();

    const result = await actions.completeProfileAction(input({ accountIntent: "SELLER" }));

    assert.equal(store.tables.users.get(USER_ID)?.role, "ADMIN", "privileged role untouched");
    assert.equal(store.tables.sellers.size, 0, "no Seller row for privileged roles");
    assert.equal(world.lastAdminUpdate?.app_metadata.role, "ADMIN");
    assertRedirect(result, "/dashboard/buyer"); // dashboardFor(ADMIN) — no admin dashboard in this build
  });

  it("a SUPER_ADMIN is preserved", async () => {
    await loadActions();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "SUPER_ADMIN",
      onboarded: false,
    });
    actingUser();

    await actions.completeProfileAction(input({ accountIntent: "BOTH" }));

    assert.equal(store.tables.users.get(USER_ID)?.role, "SUPER_ADMIN");
    assert.equal(store.tables.sellers.size, 0);
  });

  it("the legacy loop is gone: stale on-boarded=false JWT + committed onboarding → dashboard, not /complete-profile", async () => {
    await loadActions();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "BUYER",
      onboarded: true,
    });
    // The session cookie still says onboarded: false (stale).
    actingUser({ app_metadata: { onboarded: false, role: "BUYER", has_seller_profile: false } });

    const result = await actions.completeProfileAction(input());

    assertRedirect(result, "/dashboard/buyer", "destination comes from Neon, not the stale JWT");
    assert.equal(world.sessionBehavior.refreshCalls, 1, "the refresh carries the new claims");
    assert.equal(world.lastAdminUpdate?.app_metadata.onboarded, true);
  });
});

describe("completeProfileAction — failure paths", () => {
  it("metadata sync failure is NON-FATAL: the transaction committed, so the user still reaches the dashboard (no loop, no 500)", async () => {
    await loadActions();
    seedAccount(store, { id: USER_ID, email: "emmanuel@example.com", onboarded: false });
    actingUser();
    world.adminBehavior.updateUserByIdError = {
      name: "AuthApiError",
      status: 401,
      message: "invalid JWT",
    };

    const result = await actions.completeProfileAction(input());

    assertRedirect(result, "/dashboard/buyer");
    assert.equal(store.tables.profiles.get(USER_ID)?.onboarded, true, "Neon is authoritative — the commit happened");
    // The sync was attempted (and logged as a classified failure) but did not block the user.
  });

  it("Neon unavailable → controlled message, nothing committed, no session refresh", async () => {
    await loadActions();
    actingUser();
    store.failAll(new FakePrismaError("P1001", "Request timed out"));

    const result = await actions.completeProfileAction(input());

    assertFailure(
      result,
      "MaliHub's account service is temporarily unavailable. Please try again in a minute.",
    );
    assert.equal(store.tables.users.has(USER_ID), false, "the transaction was rolled back");
    assert.equal(world.lastAdminUpdate, null, "no metadata written");
    assert.equal(world.sessionBehavior.refreshCalls, 0, "no refresh of uncommitted state");
  });

  it("a unique-constraint race (P2002) → the 'already linked' copy, rolled back", async () => {
    await loadActions();
    actingUser();
    store.failAll(new FakePrismaError("P2002", "Unique constraint failed on users.phone"));

    const result = await actions.completeProfileAction(input());

    assertFailure(result, "That phone number or email is already linked to another MaliHub account.");
    assert.equal(store.tables.users.has(USER_ID), false);
    assert.equal(world.sessionBehavior.refreshCalls, 0);
  });

  it("a phone already owned by another user → friendly conflict, nothing committed", async () => {
    await loadActions();
    seedAccount(store, {
      id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
      email: "other@example.com",
      phone: "0712345678",
    });
    actingUser();

    const result = await actions.completeProfileAction(input());

    assertFailure(result, "That phone number is already linked to another MaliHub account.");
    assert.equal(store.tables.users.has(USER_ID), false);
    assert.equal(world.sessionBehavior.refreshCalls, 0);
  });

  it("no active session → 'session expired', zero database work, and the log carries the exact classification", async () => {
    await loadActions();
    world.sessionBehavior.getUser = null;

    // Capture the structured log line so the SERVER-side classification
    // (code/boundary/reason/step) is verified, not just the UI copy.
    process.env.AUTH_DEBUG = "1";
    const lines: Record<string, unknown>[] = [];
    const originalError = console.error;
    console.error = (line: string) => {
      try {
        lines.push(JSON.parse(line));
      } catch {
        /* ignore non-JSON */
      }
    };
    let result: ApiResult<{ redirectTo: string }>;
    try {
      result = await actions.completeProfileAction(input());
    } finally {
      console.error = originalError;
      delete process.env.AUTH_DEBUG;
    }

    assertFailure(result, "Your session has expired. Please sign in again.");
    assert.equal(store.statements.length, 0);
    const failure = lines.find((l) => l.event === "AUTH_FAILURE");
    assert.ok(failure, "the failure is classified in the structured log");
    assert.equal(failure?.code, "AUTHENTICATION_FAILED");
    assert.equal(failure?.boundary, "supabase-auth");
    assert.equal(failure?.reason, "no-session");
    assert.equal(failure?.step, "profile-completion");
    // The UI copy is safe and carries no diagnostics.
    if (!result.success) {
      assert.doesNotMatch(result.error, /\b(neon|prisma|supabase|gotrue)\b/i, "no infrastructure names in the UI copy");
      assert.doesNotMatch(result.error, /\bP[12]\d{3}\b/, "no error codes in the UI copy");
    }
  });

  it("invalid input → validation errors, zero database work, zero session work", async () => {
    await loadActions();
    actingUser();

    const result = await actions.completeProfileAction({
      ...input(),
      fullName: "E", // too short
      phone: "12345", // not a Kenyan number
      county: "NotACounty" as CompleteProfileInput["county"],
    });

    assert.equal(result.success, false);
    assert.equal(store.statements.length, 0);
    assert.equal(world.sessionBehavior.refreshCalls, 0);
  });
});

describe("completeProfileAction — ordering invariant (the loop-breaker)", () => {
  it("every Neon statement precedes the metadata sync, which precedes the single session refresh", async () => {
    await loadActions();
    actingUser();

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

    await actions.completeProfileAction(input({ accountIntent: "SELLER" }));

    const neonIndex = Math.max(
      ...timeline.map((e, i) => (e.startsWith("neon:") ? i : -1)),
    );
    const syncIndex = timeline.findIndex((e) => e === `supabase:admin:update-user-by-id:${USER_ID}`);
    const refreshIndex = timeline.findIndex((e) => e === "supabase:session:refresh");

    assert.ok(neonIndex >= 0, "the transaction ran");
    assert.ok(syncIndex > neonIndex, "metadata sync happened AFTER the transaction committed");
    assert.ok(refreshIndex > syncIndex, "the refresh happened after the sync");
    assert.equal(
      timeline.filter((e) => e === "supabase:session:refresh").length,
      1,
      "exactly one refresh",
    );
  });
});
