import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ApiResult } from "@/types";
import {
  createFakeAccountStore,
  type FakeStore,
  type UserRole,
} from "@/services/__tests__/fake-account-store";
import {
  AUTH_USER_ID,
  installAuthActionMocks,
  makeIdentity,
  type ProviderFixture,
} from "@/lib/auth/__tests__/provider-mock";

/**
 * `signInAction` / `signUpAction` against the real action, service and
 * provisioning code, with the provider boundary and the database substituted.
 * See `@/lib/auth/__tests__/provider-mock` for exactly what is mocked.
 *
 * ─── What changed, and what these tests now assert ─────────────────────────
 * The Supabase-era version of this suite spent most of its assertions on
 * `app_metadata` repair: sign in → read authoritative state → write it into the
 * provider's JWT claims → `refreshSession()` so the browser's cookie carried the
 * new claims → only then answer. Every one of those steps existed to keep a
 * *cache* of application state synchronized with application state, and a lag in
 * that cache is what produced the dashboard ↔ /complete-profile redirect loop.
 *
 * None of it exists now. Neon Auth has no claim store to mirror into, so the
 * action reads MaliHub's rows and answers. The interesting assertions are
 * therefore the *absences* — no metadata write, no session refresh — plus the
 * fail-closed behaviour, which is unchanged and still the part that must not
 * regress: an unreadable database must never be reported as "signed in".
 */

const store: FakeStore = createFakeAccountStore();
const provider: ProviderFixture = installAuthActionMocks(store);

let actionModule: typeof import("@/app/(auth)/actions") | null = null;
async function loadAction() {
  actionModule ??= await import("@/app/(auth)/actions");
  return actionModule;
}

const LOGIN = { email: "emmanuel@example.com", password: "Password1" };
const APP_USER_ID = "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";

/** Seeds a MaliHub account already mapped to the fixture auth identity. */
function seedAppAccount({
  onboarded = true,
  role = "BUYER",
  hasSellerProfile = false,
  authUserId = AUTH_USER_ID,
  email = LOGIN.email,
}: {
  onboarded?: boolean;
  role?: UserRole;
  hasSellerProfile?: boolean;
  authUserId?: string | null;
  email?: string;
} = {}) {
  store.tables.users.set(APP_USER_ID, {
    id: APP_USER_ID,
    email,
    authUserId,
    phone: "+254726090372",
    role,
    isActive: true,
    isBanned: false,
    emailVerified: true,
  });
  store.tables.profiles.set(APP_USER_ID, {
    userId: APP_USER_ID,
    fullName: "Emmanuel Yegon",
    avatarUrl: null,
    county: "Uasin Gishu",
    onboarded,
  });
  if (hasSellerProfile) {
    store.tables.sellers.set(APP_USER_ID, {
      userId: APP_USER_ID,
      businessName: "Yegon Electronics",
      slug: "yegon-electronics-ab12c",
      county: "Uasin Gishu",
    });
  }
  return APP_USER_ID;
}

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

describe("signInAction — routing from authoritative application state", () => {
  it("sends an onboarded buyer to /dashboard/buyer", async () => {
    seedAppAccount({ onboarded: true, role: "BUYER" });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN), "/dashboard/buyer");
  });

  it("sends an onboarded seller to /dashboard/seller", async () => {
    seedAppAccount({ onboarded: true, role: "SELLER", hasSellerProfile: true });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN), "/dashboard/seller");
  });

  it("bases seller routing on the Seller row, not on the role string", async () => {
    // A SELLER-role account whose row was never created must not be shown an
    // empty seller dashboard.
    seedAppAccount({ onboarded: true, role: "SELLER", hasSellerProfile: false });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN), "/dashboard/buyer");
  });

  it("sends an incomplete profile to /complete-profile", async () => {
    seedAppAccount({ onboarded: false });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN), "/complete-profile");
  });

  it("provisions an unmapped brand-new identity before reading its state", async () => {
    // No rows at all: this is a first sign-in after sign-up provisioning failed.
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assertRedirect(result, "/complete-profile");
    assert.equal(store.tables.users.size, 1, "the users row was created");
    const created = [...store.tables.users.values()][0]!;
    assert.equal(created.authUserId, AUTH_USER_ID);
    assert.notEqual(
      created.id,
      AUTH_USER_ID,
      "the application id is MaliHub's own, never the provider's"
    );
    assert.equal(store.tables.profiles.size, 1, "the profiles row was created");
  });
});

describe("signInAction — no claim cache to keep in sync", () => {
  it("makes no provider call other than the sign-in itself", async () => {
    seedAppAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    await signInAction(LOGIN);

    // The retired implementation called the admin API to write `app_metadata`
    // and then `refreshSession()` to re-mint the browser JWT. Neither exists
    // now: there is no claim, so there is nothing to repair or re-mint. If
    // either ever reappears in this list, the claim cache is back.
    assert.deepEqual(provider.events, ["signIn"]);
  });

  it("answers from the database even when the session's own claims are silent", async () => {
    // The provider identity carries no role and no onboarding flag at all —
    // there is nowhere for one to live. The redirect must still be correct,
    // which is only possible if it came from Postgres.
    provider.identity = makeIdentity({ name: null, image: null });
    seedAppAccount({ onboarded: true, role: "SELLER", hasSellerProfile: true });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN), "/dashboard/seller");
  });

  it("reflects a role change on the next sign-in with no cache to invalidate", async () => {
    const userId = seedAppAccount({ onboarded: true, role: "BUYER" });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN), "/dashboard/buyer");

    // An administrator promotes the account; nothing re-mints a token.
    store.tables.users.get(userId)!.role = "ADMIN";
    store.tables.sellers.set(userId, {
      userId,
      businessName: "Yegon Electronics",
      slug: "yegon-electronics-ab12c",
      county: "Uasin Gishu",
    });

    provider.events.length = 0;
    assertRedirect(await signInAction(LOGIN), "/dashboard/seller");
    assert.deepEqual(provider.events, ["signIn"]);
  });
});

describe("signInAction — fails closed", () => {
  it("clears the session and reports failure when the state read throws", async () => {
    seedAppAccount({ onboarded: true });
    const original = store.user.findUnique;
    store.user.findUnique = async (args: { where: { id?: string; authUserId?: string } }) => {
      // Provisioning resolves by authUserId; the state read resolves by id.
      if (args.where.id) throw new Error("connection terminated unexpectedly");
      return original(args);
    };
    const { signInAction } = await loadAction();

    try {
      const result = await signInAction(LOGIN);

      assert.equal(result.success, false);
      assert.match(
        result.success ? "" : result.error,
        /couldn't load your MaliHub account/i,
        "a database outage must not be reported as a credential problem"
      );
      assert.ok(
        provider.events.includes("signOut"),
        "the authenticated session is cleared rather than kept"
      );
    } finally {
      store.user.findUnique = original;
    }
  });

  it("does not treat an unreadable database as 'not onboarded'", async () => {
    // The specific fail-open this guards: interpreting a read failure as
    // `onboarded: false` sends an established customer to /complete-profile
    // during an outage, and their next successful request loops them back.
    seedAppAccount({ onboarded: true });
    const original = store.user.findUnique;
    store.user.findUnique = async (args: { where: { id?: string; authUserId?: string } }) => {
      if (args.where.id) throw new Error("connection terminated unexpectedly");
      return original(args);
    };
    const { signInAction } = await loadAction();

    try {
      const result = await signInAction(LOGIN);
      const destination = result.success ? result.data.redirectTo : null;

      assert.equal(result.success, false);
      assert.notEqual(
        destination,
        "/complete-profile",
        "an outage must never be reported as an incomplete profile"
      );
    } finally {
      store.user.findUnique = original;
    }
  });

  it("clears the session when provisioning cannot resolve an application user", async () => {
    const original = store.user.create;
    store.user.create = async () => {
      throw new Error("could not reach database server");
    };
    const { signInAction } = await loadAction();

    try {
      const result = await signInAction(LOGIN);

      assert.equal(result.success, false);
      assert.ok(provider.events.includes("signOut"));
    } finally {
      store.user.create = original;
    }
  });

  it("reports the provider's own copy for bad credentials and writes nothing", async () => {
    provider.identity = null;
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /email or password/i);
    assert.equal(store.tables.users.size, 0);
    assert.ok(!provider.events.includes("signOut"), "nothing to clear — no session was made");
  });

  it("distinguishes an unreachable auth service from wrong credentials", async () => {
    provider.identity = null;
    provider.failure = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /couldn't reach the sign-in service/i);
  });

  it("rejects malformed input before contacting the provider", async () => {
    const { signInAction } = await loadAction();

    const result = await signInAction({ email: "not-an-email", password: "" });

    assert.equal(result.success, false);
    assert.ok(result.fieldErrors?.email, "the email problem is reported per-field");
    assert.deepEqual(provider.events, []);
  });
});

describe("signInAction — redirect targets", () => {
  it("honours a safe internal redirectTo", async () => {
    seedAppAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    assertRedirect(
      await signInAction(LOGIN, "/dashboard/buyer/wishlist?sort=recent"),
      "/dashboard/buyer/wishlist?sort=recent"
    );
  });

  it("ignores a protocol-relative redirectTo and falls back to the dashboard", async () => {
    seedAppAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN, "//evil.example/steal-session"), "/dashboard/buyer");
  });

  it("ignores an absolute external redirectTo", async () => {
    seedAppAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    assertRedirect(
      await signInAction(LOGIN, "https://evil.example/steal-session"),
      "/dashboard/buyer"
    );
  });

  it("ignores a backslash-normalized redirectTo", async () => {
    seedAppAccount({ onboarded: true });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN, "/\\evil.example"), "/dashboard/buyer");
  });

  it("never honours a redirectTo for an account that has not finished onboarding", async () => {
    seedAppAccount({ onboarded: false });
    const { signInAction } = await loadAction();

    assertRedirect(await signInAction(LOGIN, "/dashboard/seller"), "/complete-profile");
  });
});

describe("signInAction — legacy account linking", () => {
  it("refuses to hijack an unmapped legacy email by default", async () => {
    // A pre-migration MaliHub row with the same address and no provider mapping.
    store.tables.users.set("legacy-row", {
      id: "legacy-row",
      email: LOGIN.email,
      authUserId: null,
      phone: null,
      role: "SELLER",
      isActive: true,
      isBanned: false,
      emailVerified: true,
    });
    const { signInAction } = await loadAction();

    const result = await signInAction(LOGIN);

    // Fails closed rather than silently creating a second account for the same
    // person — which would split their orders, listings and messages in two.
    assert.equal(result.success, false);
    assert.equal(store.tables.users.size, 1, "no duplicate account was created");
    assert.equal(store.tables.users.get("legacy-row")?.authUserId, null);
  });
});

describe("signUpAction", () => {
  it("creates the account, provisions rows, and reports the email to verify", async () => {
    const { signUpAction } = await loadAction();

    const result = await signUpAction({
      email: "new@example.com",
      password: "Password1",
      confirmPassword: "Password1",
      agreeToTerms: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.success && result.data.email, "new@example.com");
    assert.equal(store.tables.users.size, 1);
    assert.equal(store.tables.profiles.size, 1);
  });

  it("seeds the provider display name from the email when the form has none", async () => {
    const { signUpAction } = await loadAction();

    await signUpAction({
      email: "new@example.com",
      password: "Password1",
      confirmPassword: "Password1",
      agreeToTerms: true,
    });

    const [args] = provider.calls.signUp![0]!;
    // `neon_auth.user.name` is NOT NULL, so an empty string would turn a valid
    // registration into a provider-side failure.
    assert.equal((args as { name: string }).name, "new");
  });

  it("still succeeds when row provisioning fails — /complete-profile retries it", async () => {
    const original = store.user.create;
    store.user.create = async () => {
      throw new Error("could not reach database server");
    };
    const { signUpAction } = await loadAction();

    try {
      const result = await signUpAction({
        email: "new@example.com",
        password: "Password1",
        confirmPassword: "Password1",
        agreeToTerms: true,
      });

      // The auth account exists upstream; failing the action here would lose it
      // and leave the person unable to register at all during a database blip.
      assert.equal(result.success, true);
    } finally {
      store.user.create = original;
    }
  });

  it("surfaces the provider's copy when the email is already registered", async () => {
    provider.identity = null;
    provider.failure = {
      code: "email_taken",
      message: "An account with that email already exists. Try signing in instead.",
    };
    const { signUpAction } = await loadAction();

    const result = await signUpAction({
      email: "taken@example.com",
      password: "Password1",
      confirmPassword: "Password1",
      agreeToTerms: true,
    });

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /already exists/i);
    assert.equal(store.tables.users.size, 0);
  });

  it("rejects a password confirmation mismatch without contacting the provider", async () => {
    const { signUpAction } = await loadAction();

    const result = await signUpAction({
      email: "new@example.com",
      password: "Password1",
      confirmPassword: "Password2",
      agreeToTerms: true,
    });

    assert.equal(result.success, false);
    assert.deepEqual(provider.events, []);
  });
});
