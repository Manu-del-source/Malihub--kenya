import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
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
 * Behavior tests for /api/auth/callback — the single landing point for
 * Google OAuth, "confirm email" and "reset password" links.
 *
 * Contract pinned here:
 *   exchange code → settle (ensure Neon → sync claims → ONE refresh)
 *   → safe internal `next` if given, else route from CANONICAL Neon state
 *   → on settlement failure: KEEP the session, go to the self-healing
 *     /complete-profile (no forced re-login, no loop, no crash)
 */

const store: FakeAccountStore = createFakeAccountStore();
const world: FakeSupabaseWorld = createFakeSupabaseWorld();

mock.module("server-only", { namedExports: {} });
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

let route: typeof import("@/app/api/auth/callback/route");
async function loadRoute() {
  route ??= await import("@/app/api/auth/callback/route");
  return route;
}

const ORIGIN = "https://malihub.smartbiz365.site";
const USER_ID = "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";

function oauthUser(overrides: Parameters<typeof fakeSupabaseUser>[0] = {}) {
  const user = fakeSupabaseUser({
    id: USER_ID,
    email: "emmanuel@example.com",
    user_metadata: { full_name: "Emmanuel Yegon", picture: "https://lh3.googleusercontent.com/x" },
    ...overrides,
  });
  world.sessionBehavior.exchangeCodeForSessionUser = user;
  world.sessionBehavior.getUser = user;
  world.users.set(USER_ID, user);
  return user;
}

function callbackRequest(query: string) {
  return new NextRequest(`${ORIGIN}/api/auth/callback?${query}`);
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

async function follow(response: Response): Promise<string> {
  const location = response.headers.get("location");
  assert.ok(location, `expected a redirect response, got status ${response.status}`);
  return location as string;
}

describe("GET /api/auth/callback — OAuth + verification flows", () => {
  it("a brand-new OAuth user is provisioned (no escalation) and sent to /complete-profile", async () => {
    await loadRoute();
    oauthUser(); // no Neon rows exist yet

    const response = await route.GET(callbackRequest("code=abc123"));

    const location = await follow(response);
    assert.equal(location, `${ORIGIN}/complete-profile`);
    assert.ok(store.tables.users.has(USER_ID), "the users row was created");
    assert.equal(store.tables.users.get(USER_ID)?.role, "BUYER", "no role granted by OAuth");
    assert.equal(store.tables.profiles.get(USER_ID)?.onboarded, false, "no false onboarding");
    assert.deepEqual(world.lastAdminUpdate?.app_metadata, {
      onboarded: false,
      role: "BUYER",
      has_seller_profile: false,
    });
    assert.equal(world.sessionBehavior.refreshCalls, 1);
  });

  it("an existing onboarded SELLER lands on /dashboard/seller", async () => {
    await loadRoute();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "SELLER",
      onboarded: true,
      seller: { businessName: "Yegon Electronics" },
    });
    oauthUser({ app_metadata: { onboarded: true, role: "SELLER", has_seller_profile: true } });

    const response = await route.GET(callbackRequest("code=abc123"));

    assert.equal(await follow(response), `${ORIGIN}/dashboard/seller`);
    assert.equal(world.sessionBehavior.refreshCalls, 1, "exactly one refresh in the whole flow");
  });

  it("a safe internal `next` is honored", async () => {
    await loadRoute();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "BUYER",
      onboarded: true,
    });
    oauthUser();

    const response = await route.GET(
      callbackRequest(`code=abc123&next=${encodeURIComponent("/dashboard/buyer/orders?status=open")}`),
    );

    assert.equal(await follow(response), `${ORIGIN}/dashboard/buyer/orders?status=open`);
  });

  it("a malicious `next` is IGNORED and the canonical destination is used", async () => {
    await loadRoute();
    seedAccount(store, {
      id: USER_ID,
      email: "emmanuel@example.com",
      role: "BUYER",
      onboarded: true,
    });
    oauthUser();

    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "\\\\evil.example",
      "javascript:alert(1)",
    ]) {
      const response = await route.GET(
        callbackRequest(`code=abc123&next=${encodeURIComponent(hostile)}`),
      );
      assert.equal(
        await follow(response),
        `${ORIGIN}/dashboard/buyer`,
        `hostile next was honored for ${hostile}`,
      );
    }
  });

  it("missing code → /login with a controlled error, no session work", async () => {
    await loadRoute();
    const response = await route.GET(callbackRequest(""));

    const location = await follow(response);
    assert.ok(location.startsWith(`${ORIGIN}/login?error=`));
    assert.ok(decodeURIComponent(location).includes("Missing verification code"));
    assert.equal(store.statements.length, 0);
    assert.equal(world.events.filter((e) => e.startsWith("session:exchange-code")).length, 0);
  });

  it("an expired/used code → /login with the 'link expired' copy", async () => {
    await loadRoute();
    world.sessionBehavior.exchangeCodeForSessionError = {
      name: "AuthApiError",
      status: 400,
      message: "Expired timestamp",
    };

    const response = await route.GET(callbackRequest("code=stale"));

    const location = await follow(response);
    assert.ok(location.startsWith(`${ORIGIN}/login?error=`));
    assert.ok(decodeURIComponent(location).includes("That link has expired or was already used."));
    assert.equal(store.statements.length, 0, "nothing was provisioned for a dead code");
  });

  it("settlement failure (Neon down) → the session is KEPT and the user is sent to the self-healing /complete-profile (no crash, no forced re-login)", async () => {
    await loadRoute();
    oauthUser();
    store.failAll(new FakePrismaError("P1001", "Request timed out"));

    const response = await route.GET(callbackRequest("code=abc123"));

    assert.equal(await follow(response), `${ORIGIN}/complete-profile`);
    assert.equal(world.sessionBehavior.signOutCalls, 0, "the established session is NOT destroyed");
    assert.equal(world.lastAdminUpdate, null, "no metadata written from unverified state");
  });

  it("settlement failure (Admin mirror down) → same controlled landing", async () => {
    await loadRoute();
    oauthUser();
    world.adminBehavior.updateUserByIdError = {
      name: "AuthApiError",
      status: 401,
      message: "invalid JWT",
    };

    const response = await route.GET(callbackRequest("code=abc123"));

    assert.equal(await follow(response), `${ORIGIN}/complete-profile`);
    assert.equal(world.sessionBehavior.signOutCalls, 0);
  });
});
