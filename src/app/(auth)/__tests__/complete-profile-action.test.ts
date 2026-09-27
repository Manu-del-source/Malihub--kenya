import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ApiResult } from "@/types";
import {
  createFakeAccountStore,
  type FakeStore,
} from "@/services/__tests__/fake-account-store";
import {
  AUTH_USER_ID,
  installAuthActionMocks,
  makeIdentity,
  type ProviderFixture,
} from "@/lib/auth/__tests__/provider-mock";

/**
 * `completeProfileAction` — the onboarding write.
 *
 * ─── Why this suite looks nothing like its predecessor ─────────────────────
 * The Supabase-era version of this file was a regression test for a redirect
 * loop. The profile transaction committed, `app_metadata` was repaired
 * server-side, but the JWT already sitting in the browser's cookie still carried
 * `onboarded: false` — so middleware bounced the fresh dashboard request straight
 * back to /complete-profile. The fix was a `refreshSession()` call to re-mint the
 * token, and most of the old assertions existed to prove that call happened.
 *
 * There is no token claim to re-mint now, so the loop is structurally impossible
 * and those assertions are gone. What replaces them is the assertion that the
 * action makes NO further provider call at all after the write commits — because
 * if it ever does, a claim cache has crept back in.
 *
 * What is still worth pinning is the provisioning behaviour, which is the reason
 * this action exists: a brand-new account can arrive here with no `users` or
 * `profiles` row, and the write must create them inside its own transaction.
 */

const store: FakeStore = createFakeAccountStore();
const provider: ProviderFixture = installAuthActionMocks(store);

let actionModule: typeof import("@/app/(auth)/actions") | null = null;
async function loadAction() {
  actionModule ??= await import("@/app/(auth)/actions");
  return actionModule;
}

const VALID_INPUT = {
  fullName: "Emmanuel Yegon",
  phone: "+254726090372",
  county: "Uasin Gishu" as const,
  accountIntent: "BOTH" as const,
  avatarUrl: "",
};

function resetFakes() {
  provider.reset();
  store.tables.users.clear();
  store.tables.profiles.clear();
  store.tables.sellers.clear();
}

function assertRedirect(
  result: ApiResult<{ redirectTo: string }>,
  expected: string
): void {
  assert.equal(result.success, true, result.success ? "" : result.error);
  assert.equal(result.success && result.data.redirectTo, expected);
}

beforeEach(resetFakes);

describe("completeProfileAction — first-time onboarding", () => {
  it("provisions and completes an account that has no application rows yet", async () => {
    // The case the old code hit as Prisma's P2025: the provider authenticated a
    // person whose `users`/`profiles` rows were never created.
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction(VALID_INPUT);

    assertRedirect(result, "/dashboard/seller");
    assert.equal(store.tables.users.size, 1);
    assert.equal(store.tables.profiles.size, 1);

    const user = [...store.tables.users.values()][0]!;
    assert.equal(user.authUserId, AUTH_USER_ID);
    assert.equal(user.role, "SELLER");
    assert.equal(user.phone, "+254726090372");

    const profile = store.tables.profiles.get(user.id)!;
    assert.equal(profile.onboarded, true);
    assert.equal(profile.county, "Uasin Gishu");
    assert.equal(profile.fullName, "Emmanuel Yegon");
  });

  it("creates a starter Seller row when the person opts into selling", async () => {
    const { completeProfileAction } = await loadAction();

    await completeProfileAction(VALID_INPUT);

    assert.equal(store.tables.sellers.size, 1);
    const seller = [...store.tables.sellers.values()][0]!;
    assert.equal(seller.businessName, "Emmanuel Yegon");
    assert.equal(seller.county, "Uasin Gishu");
  });

  it("sends a buyer-only account to the buyer dashboard and creates no Seller row", async () => {
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...VALID_INPUT, accountIntent: "BUYER" });

    assertRedirect(result, "/dashboard/buyer");
    assert.equal(store.tables.sellers.size, 0);
    const user = [...store.tables.users.values()][0]!;
    assert.equal(user.role, "BUYER");
  });

  it("reuses the rows an earlier sign-in already provisioned", async () => {
    store.tables.users.set("existing-app-user", {
      id: "existing-app-user",
      email: "emmanuel@example.com",
      authUserId: AUTH_USER_ID,
      phone: null,
      role: "BUYER",
      isActive: true,
      isBanned: false,
      emailVerified: true,
    });
    store.tables.profiles.set("existing-app-user", {
      userId: "existing-app-user",
      fullName: "",
      avatarUrl: null,
      county: null,
      onboarded: false,
    });
    const { completeProfileAction } = await loadAction();

    await completeProfileAction({ ...VALID_INPUT, accountIntent: "SELLER" });

    assert.equal(store.tables.users.size, 1, "no second account for the same person");
    assert.equal(store.tables.profiles.get("existing-app-user")?.onboarded, true);
    assert.equal(store.tables.profiles.get("existing-app-user")?.fullName, "Emmanuel Yegon");
  });
});

describe("completeProfileAction — no claim cache to re-mint", () => {
  it("makes no provider call after the profile write commits", async () => {
    const { completeProfileAction } = await loadAction();

    await completeProfileAction(VALID_INPUT);

    // The retired implementation followed the commit with `refreshSession()` so
    // the browser's JWT would carry `onboarded: true`. There is no claim now, so
    // the next request simply reads the new value from Postgres — and any
    // provider call beyond reading the session would mean the cache is back.
    assert.deepEqual(
      provider.events.filter((event) => event !== "readAuthSession"),
      []
    );
  });

  it("leaves the session untouched, so the next request reads fresh state", async () => {
    const sessionBefore = provider.session;
    const { completeProfileAction } = await loadAction();

    await completeProfileAction(VALID_INPUT);

    assert.equal(provider.session, sessionBefore, "the session was not re-minted");
    assert.ok(!provider.events.includes("signOut"));
  });
});

describe("completeProfileAction — refuses without a usable identity", () => {
  it("reports an expired session when nobody is signed in", async () => {
    provider.session = null;
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction(VALID_INPUT);

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /session has expired/i);
    assert.equal(store.tables.users.size, 0, "nothing was written");
  });

  it("says 'try again' rather than 'your account is broken' during an outage", async () => {
    provider.session = null;
    provider.sessionFailure = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction(VALID_INPUT);

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /couldn't reach the sign-in service/i);
  });

  it("refuses a banned account", async () => {
    store.tables.users.set("banned-user", {
      id: "banned-user",
      email: "emmanuel@example.com",
      authUserId: AUTH_USER_ID,
      phone: null,
      role: "BUYER",
      isActive: true,
      isBanned: true,
      emailVerified: true,
    });
    provider.session = makeIdentity();
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction(VALID_INPUT);

    assert.equal(result.success, false);
    assert.equal(store.tables.profiles.size, 0);
  });

  it("does not require an existing application row — that is the whole point", async () => {
    // Guards used elsewhere (`requireUser`) redirect an unmapped identity to
    // /complete-profile. If this action used the same guard, onboarding would be
    // unreachable: the repair path would require the thing it repairs.
    assert.equal(store.tables.users.size, 0);
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction(VALID_INPUT);

    assert.equal(result.success, true);
  });
});

describe("completeProfileAction — validation and conflicts", () => {
  it("rejects an invalid phone number before touching the database", async () => {
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...VALID_INPUT, phone: "12345" });

    assert.equal(result.success, false);
    assert.ok(result.fieldErrors?.phone);
    assert.equal(store.tables.users.size, 0);
  });

  it("rejects a county outside Kenya's list", async () => {
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({
      ...VALID_INPUT,
      county: "Atlantis" as unknown as typeof VALID_INPUT.county,
    });

    assert.equal(result.success, false);
    assert.ok(result.fieldErrors?.county);
  });

  it("rejects a name that is too short to be a name", async () => {
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction({ ...VALID_INPUT, fullName: "E" });

    assert.equal(result.success, false);
    assert.ok(result.fieldErrors?.fullName);
  });

  it("reports a friendly conflict when another account already claimed the phone number", async () => {
    store.tables.users.set("other-account", {
      id: "other-account",
      email: "someone-else@example.com",
      authUserId: "neon-auth-user-other",
      phone: "+254726090372",
      role: "BUYER",
      isActive: true,
      isBanned: false,
      emailVerified: true,
    });
    const { completeProfileAction } = await loadAction();

    const result = await completeProfileAction(VALID_INPUT);

    assert.equal(result.success, false);
    assert.match(
      result.success ? "" : result.error,
      /phone number is already linked to another MaliHub account/i
    );
    assert.equal(
      store.tables.profiles.size,
      0,
      "the transaction rolled back — no partially written profile"
    );
  });

  it("accepts an avatar URL and stores it on the profile", async () => {
    const { completeProfileAction } = await loadAction();

    await completeProfileAction({
      ...VALID_INPUT,
      avatarUrl: "https://cdn.example.com/avatar.png",
    });

    const profile = [...store.tables.profiles.values()][0]!;
    assert.equal(profile.avatarUrl, "https://cdn.example.com/avatar.png");
  });

  it("stores an empty avatar as null rather than an empty string", async () => {
    const { completeProfileAction } = await loadAction();

    await completeProfileAction({ ...VALID_INPUT, avatarUrl: "" });

    assert.equal([...store.tables.profiles.values()][0]!.avatarUrl, null);
  });
});
