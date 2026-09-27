import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeAccountStore,
  type FakeStore,
  type UserRole,
} from "@/services/__tests__/fake-account-store";
import {
  AUTH_USER_ID,
  installAuthActionMocks,
  makeIdentity,
  RedirectSignal,
  type ProviderFixture,
} from "@/lib/auth/__tests__/provider-mock";

/**
 * The authorization layer: `src/lib/auth/session.ts`.
 *
 * This is the half of the migration that replaced `app_metadata`. Middleware now
 * answers only "is there a session?", so every decision about WHAT a person may
 * do happens here, from MaliHub's own rows. These tests are therefore the ones
 * that matter most for security: a guard that fails open is an access-control
 * hole, and there is no second line of defence behind it.
 *
 * The consistent rule under test is that an inability to READ state is never
 * treated as a permission decision. "Database unreachable" must not become
 * "not an admin" (which would let a request through to a page that then reads
 * the same database and crashes) nor "is an admin".
 */

const store: FakeStore = createFakeAccountStore();
const provider: ProviderFixture = installAuthActionMocks(store);

let authModule: typeof import("@/lib/auth") | null = null;
async function loadAuth() {
  authModule ??= await import("@/lib/auth");
  return authModule;
}

const APP_USER_ID = "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";

function seedAccount({
  onboarded = true,
  role = "BUYER",
  hasSellerProfile = false,
  isBanned = false,
  isActive = true,
  authUserId = AUTH_USER_ID,
}: {
  onboarded?: boolean;
  role?: UserRole;
  hasSellerProfile?: boolean;
  isBanned?: boolean;
  isActive?: boolean;
  authUserId?: string | null;
} = {}) {
  store.tables.users.set(APP_USER_ID, {
    id: APP_USER_ID,
    email: "emmanuel@example.com",
    authUserId,
    phone: "+254726090372",
    role,
    isActive,
    isBanned,
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
}

beforeEach(() => {
  provider.reset();
  store.tables.users.clear();
  store.tables.profiles.clear();
  store.tables.sellers.clear();
});

/** Asserts a guard redirected, and returns where. */
async function captureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination;
    throw error;
  }
  throw new Error("expected the guard to redirect, but it returned normally");
}

describe("getCurrentUser — the read every guard is built on", () => {
  it("returns null for a signed-out visitor", async () => {
    provider.session = null;
    const { getCurrentUser } = await loadAuth();

    assert.equal(await getCurrentUser(), null);
  });

  it("returns the identity and application access for a mapped account", async () => {
    seedAccount({ role: "SELLER", hasSellerProfile: true });
    const { getCurrentUser } = await loadAuth();

    const current = await getCurrentUser();

    assert.ok(current);
    assert.equal(current.identity.authUserId, AUTH_USER_ID);
    assert.equal(current.user?.id, APP_USER_ID);
    assert.equal(current.user?.role, "SELLER");
    assert.equal(current.user?.hasSellerProfile, true);
    assert.equal(current.user?.onboarded, true);
  });

  it("returns an identity with a null user when no application row is mapped", async () => {
    provider.session = makeIdentity();
    const { getCurrentUser } = await loadAuth();

    const current = await getCurrentUser();

    // Distinct from "signed out": the person IS authenticated, MaliHub just has
    // no row for them yet. Collapsing the two would send a brand-new account to
    // /login in a loop instead of to /complete-profile.
    assert.ok(current, "an unmapped identity is still a current user");
    assert.equal(current.user, null);
  });

  it("does not write anything — reading a session never provisions", async () => {
    provider.session = makeIdentity();
    const { getCurrentUser } = await loadAuth();

    await getCurrentUser();

    assert.equal(store.tables.users.size, 0);
    assert.equal(store.tables.profiles.size, 0);
  });

  it("isAuthenticated reflects the session, not the application row", async () => {
    provider.session = makeIdentity();
    const { isAuthenticated } = await loadAuth();

    assert.equal(await isAuthenticated(), true);

    provider.session = null;
    assert.equal(await isAuthenticated(), false);
  });
});

describe("requireUser — the baseline protected-page guard", () => {
  it("returns the account for a mapped, active user", async () => {
    seedAccount();
    const { requireUser } = await loadAuth();

    const { user } = await requireUser();

    assert.equal(user.id, APP_USER_ID);
    assert.equal(user.email, "emmanuel@example.com");
  });

  it("redirects a signed-out visitor to /login", async () => {
    provider.session = null;
    const { requireUser } = await loadAuth();

    assert.equal(await captureRedirect(() => requireUser()), "/login");
  });

  it("redirects an unmapped identity to /complete-profile, which provisions it", async () => {
    provider.session = makeIdentity();
    const { requireUser } = await loadAuth();

    assert.equal(await captureRedirect(() => requireUser()), "/complete-profile");
  });

  it("redirects a banned account away without routing it back to /login", async () => {
    seedAccount({ isBanned: true });
    const { requireUser } = await loadAuth();

    // Not /login: the account exists and authenticates fine, so bouncing it to
    // the sign-in form is both confusing and a way to probe which accounts are
    // banned.
    const destination = await captureRedirect(() => requireUser());
    assert.notEqual(destination, "/login");
  });

  it("redirects a deactivated account away", async () => {
    seedAccount({ isActive: false });
    const { requireUser } = await loadAuth();

    assert.notEqual(await captureRedirect(() => requireUser()), "/login");
  });

  it("fails closed when the application database cannot be read", async () => {
    seedAccount();
    const original = store.user.findUnique;
    store.user.findUnique = async () => {
      throw new Error("connection terminated unexpectedly");
    };
    const { requireUser } = await loadAuth();

    try {
      // Must not resolve to a usable user: an unreadable database is not
      // evidence that anybody is authorized.
      await assert.rejects(() => requireUser());
    } finally {
      store.user.findUnique = original;
    }
  });

  it("does not require onboarding — that is requireOnboardedUser's job", async () => {
    seedAccount({ onboarded: false });
    const { requireUser } = await loadAuth();

    const { user } = await requireUser();
    assert.equal(user.onboarded, false);
  });
});

describe("requireOnboardedUser", () => {
  it("passes an onboarded account through", async () => {
    seedAccount({ onboarded: true });
    const { requireOnboardedUser } = await loadAuth();

    assert.equal((await requireOnboardedUser()).user.onboarded, true);
  });

  it("sends an incomplete profile to /complete-profile", async () => {
    seedAccount({ onboarded: false });
    const { requireOnboardedUser } = await loadAuth();

    assert.equal(await captureRedirect(() => requireOnboardedUser()), "/complete-profile");
  });

  it("treats a missing profile row as not onboarded", async () => {
    seedAccount({ onboarded: true });
    store.tables.profiles.clear();
    const { requireOnboardedUser } = await loadAuth();

    // A users row without a profiles row is a partially provisioned account,
    // and must never be read as "onboarded".
    assert.equal(await captureRedirect(() => requireOnboardedUser()), "/complete-profile");
  });
});

describe("requireSellerAccess", () => {
  it("passes an account with a Seller row", async () => {
    seedAccount({ role: "SELLER", hasSellerProfile: true });
    const { requireSellerAccess } = await loadAuth();

    assert.equal((await requireSellerAccess()).user.hasSellerProfile, true);
  });

  it("bases access on the Seller row, not on the role string", async () => {
    // A SELLER-role account whose row was never created must not be shown an
    // empty seller dashboard.
    seedAccount({ role: "SELLER", hasSellerProfile: false });
    const { requireSellerAccess } = await loadAuth();

    assert.equal(await captureRedirect(() => requireSellerAccess()), "/dashboard/buyer");
  });

  it("grants access to a BUYER-role account that does have a Seller row", async () => {
    // The inverse: the row is the fact that matters, and every role can sell
    // once it has one.
    seedAccount({ role: "BUYER", hasSellerProfile: true });
    const { requireSellerAccess } = await loadAuth();

    assert.equal((await requireSellerAccess()).user.role, "BUYER");
  });

  it("lets an administrator through for support even with no Seller row", async () => {
    seedAccount({ role: "ADMIN", hasSellerProfile: false });
    const { requireSellerAccess } = await loadAuth();

    assert.equal((await requireSellerAccess()).user.role, "ADMIN");
  });

  it("redirects a buyer to their own dashboard rather than to /login", async () => {
    seedAccount({ role: "BUYER", hasSellerProfile: false });
    const { requireSellerAccess } = await loadAuth();

    // They are authenticated and welcome — just not here.
    assert.equal(await captureRedirect(() => requireSellerAccess()), "/dashboard/buyer");
  });

  it("requires onboarding first", async () => {
    seedAccount({ onboarded: false, hasSellerProfile: true });
    const { requireSellerAccess } = await loadAuth();

    assert.equal(await captureRedirect(() => requireSellerAccess()), "/complete-profile");
  });
});

describe("requireAdministrator — the authoritative admin check", () => {
  it("passes ADMIN and SUPER_ADMIN", async () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
      store.tables.users.clear();
      seedAccount({ role });
      const { requireAdministrator } = await loadAuth();

      assert.equal((await requireAdministrator()).user.role, role);
    }
  });

  it("refuses SELLER and BUYER", async () => {
    for (const role of ["SELLER", "BUYER"] as const) {
      store.tables.users.clear();
      seedAccount({ role });
      const { requireAdministrator } = await loadAuth();

      await assert.rejects(
        () => requireAdministrator(),
        (error: unknown) => error instanceof RedirectSignal
      );
    }
  });

  it("cannot be satisfied by anything in the session", async () => {
    // The provider identity has no role field at all — there is nowhere to put
    // one. An attacker who could forge or edit a session payload still could not
    // reach an admin route, because this check reads a Postgres row.
    seedAccount({ role: "BUYER" });
    provider.session = makeIdentity({ name: "SUPER_ADMIN" });
    const { requireAdministrator } = await loadAuth();

    await assert.rejects(
      () => requireAdministrator(),
      (error: unknown) => error instanceof RedirectSignal
    );
  });

  it("reflects a role change on the next request with no cache to invalidate", async () => {
    seedAccount({ role: "BUYER" });
    const { requireAdministrator } = await loadAuth();

    await assert.rejects(() => requireAdministrator());

    store.tables.users.get(APP_USER_ID)!.role = "SUPER_ADMIN";

    // The retired design wrote the role into a JWT claim, so this promotion took
    // effect only after the session was refreshed. It is immediate now.
    assert.equal((await requireAdministrator()).user.role, "SUPER_ADMIN");
  });

  it("fails closed when the role cannot be read", async () => {
    seedAccount({ role: "SUPER_ADMIN" });
    const original = store.user.findUnique;
    store.user.findUnique = async () => {
      throw new Error("connection terminated unexpectedly");
    };
    const { requireAdministrator } = await loadAuth();

    try {
      await assert.rejects(() => requireAdministrator());
    } finally {
      store.user.findUnique = original;
    }
  });
});

describe("requireRole", () => {
  it("accepts a role in the allow-list and refuses one outside it", async () => {
    seedAccount({ role: "SELLER" });
    const { requireRole } = await loadAuth();

    assert.equal((await requireRole(["SELLER", "ADMIN"])).user.role, "SELLER");
    assert.equal(await captureRedirect(() => requireRole(["ADMIN"])), "/dashboard/buyer");
  });
});

describe("action guards — no redirect, an answer instead", () => {
  it("requireActionUser returns an error object rather than throwing", async () => {
    provider.session = null;
    const { requireActionUser } = await loadAuth();

    const result = await requireActionUser();

    // A Server Action's caller is a form expecting a result to toast; a thrown
    // redirect would surface as Next's error boundary instead.
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /session has expired/i);
  });

  it("requireActionUser returns the account when everything checks out", async () => {
    seedAccount();
    const { requireActionUser } = await loadAuth();

    const result = await requireActionUser();

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.user.id, APP_USER_ID);
  });

  it("requireActionUser refuses a banned account with copy safe to show", async () => {
    seedAccount({ isBanned: true });
    const { requireActionUser } = await loadAuth();

    const result = await requireActionUser();

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /contact support/i);
      assert.ok(!result.error.includes(APP_USER_ID));
    }
  });

  it("requireActionIdentity succeeds for an identity with no application row", async () => {
    provider.session = makeIdentity();
    const { requireActionIdentity } = await loadAuth();

    const result = await requireActionIdentity();

    // /complete-profile depends on this: the repair path cannot require the
    // thing it repairs.
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.identity.authUserId, AUTH_USER_ID);
  });

  it("requireOnboardedActionUser refuses an incomplete profile without redirecting", async () => {
    seedAccount({ onboarded: false });
    const { requireOnboardedActionUser } = await loadAuth();

    const result = await requireOnboardedActionUser();

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /finish setting up your profile/i);
  });

  it("distinguishes an outage from a signed-out session", async () => {
    provider.session = null;
    provider.sessionFailure = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { requireActionUser } = await loadAuth();

    const result = await requireActionUser();

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /couldn't reach the sign-in service/i);
      assert.ok(
        !result.error.includes("expired"),
        "an outage must not be reported as an expired session"
      );
    }
  });
});
