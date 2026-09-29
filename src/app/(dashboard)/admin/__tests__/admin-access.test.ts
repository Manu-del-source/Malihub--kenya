import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createFakeAccountStore,
  type FakeStore,
  type UserRole,
} from "@/services/__tests__/fake-account-store";
import {
  AUTH_USER_ID,
  installAuthActionMocks,
  RedirectSignal,
  type ProviderFixture,
} from "@/lib/auth/__tests__/provider-mock";

/**
 * THE gate in front of `/admin`.
 *
 * These are the security tests the admin dashboard lives or dies by: the
 * dashboard layout calls `requireAdministrator()` (redirecting guard — pages),
 * and every admin Server Action calls `requireAdministratorAction()`
 * (answering guard — mutations reachable without rendering the page at all).
 * Both are exercised here as production code against the mocked provider
 * session and an in-memory store — nothing is stubbed except "what did Neon
 * Auth say?" and "what is in the database?".
 *
 * The matrix encodes one rule each:
 *   1. no session            → /login, never /admin content
 *   2. BUYER                 → denied, no admin data, no mutations
 *   3. SELLER                → denied (having a seller profile changes nothing)
 *   4. ADMIN                 → allowed
 *   5. SUPER_ADMIN           → allowed exactly like ADMIN — the same
 *                              ADMINISTRATOR_ROLES membership the pre-admin
 *                              codebase already defined; no extra powers
 *                              invented, none removed
 *   + banned accounts, deactivated accounts and unmapped identities all fail
 *     closed, including ones holding an ADMIN role.
 */

const store: FakeStore = createFakeAccountStore();
const provider: ProviderFixture = installAuthActionMocks(store);

let auth: typeof import("@/lib/auth") | null = null;
async function loadAuth() {
  auth ??= await import("@/lib/auth");
  return auth;
}

const ADMIN_ID = randomUUID();

function seed({
  role,
  onboarded = true,
  isBanned = false,
  isActive = true,
  hasSellerProfile = false,
}: {
  role: UserRole;
  onboarded?: boolean;
  isBanned?: boolean;
  isActive?: boolean;
  hasSellerProfile?: boolean;
}) {
  store.tables.users.set(ADMIN_ID, {
    id: ADMIN_ID,
    email: "someone@example.com",
    authUserId: AUTH_USER_ID,
    phone: null,
    role,
    isActive,
    isBanned,
    emailVerified: true,
  });
  store.tables.profiles.set(ADMIN_ID, {
    userId: ADMIN_ID,
    fullName: "Someone",
    avatarUrl: null,
    county: null,
    onboarded,
  });
  if (hasSellerProfile) {
    store.tables.sellers.set(ADMIN_ID, {
      userId: ADMIN_ID,
      businessName: "Someone Electronics",
      slug: "someone-electronics",
      county: "Nairobi",
    });
  }
}

beforeEach(() => {
  provider.reset();
  store.tables.users.clear();
  store.tables.profiles.clear();
  store.tables.sellers.clear();
});

async function captureRedirect(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination;
    throw error;
  }
}

describe("requireAdministrator — the /admin page gate", () => {
  it("unauthenticated visitors are sent to /login (test 1)", async () => {
    provider.session = null;
    const { requireAdministrator } = await loadAuth();

    assert.equal(await captureRedirect(() => requireAdministrator()), "/login");
  });

  it("BUYER accounts cannot open /admin (test 2)", async () => {
    seed({ role: "BUYER" });
    const { requireAdministrator } = await loadAuth();

    // Denied to "/", NOT to /login: the session is fine, the permission isn't.
    assert.equal(await captureRedirect(() => requireAdministrator()), "/");
  });

  it("SELLER accounts cannot open /admin — seller status grants nothing here (test 3)", async () => {
    seed({ role: "SELLER", hasSellerProfile: true });
    const { requireAdministrator } = await loadAuth();

    assert.equal(await captureRedirect(() => requireAdministrator()), "/");
  });

  it("ADMIN accounts pass (test 4)", async () => {
    seed({ role: "ADMIN" });
    const { requireAdministrator } = await loadAuth();

    const current = await requireAdministrator();
    assert.equal(current.user.id, ADMIN_ID);
    assert.equal(current.user.role, "ADMIN");
  });

  it("SUPER_ADMIN passes exactly like ADMIN (test 5)", async () => {
    seed({ role: "SUPER_ADMIN" });
    const { requireAdministrator, ADMINISTRATOR_ROLES, isAdministratorRole } = await loadAuth();

    const current = await requireAdministrator();
    assert.equal(current.user.role, "SUPER_ADMIN");
    assert.ok(isAdministratorRole("SUPER_ADMIN"));
    assert.ok(isAdministratorRole("ADMIN"));
    assert.deepEqual([...ADMINISTRATOR_ROLES], ["ADMIN", "SUPER_ADMIN"]);
    // …and the two roles stay distinct values — the admin area deliberately
    // adds no SUPER_ADMIN-only powers, and no BUYER/SELLER joins them.
    assert.notEqual("SUPER_ADMIN", "ADMIN");
    assert.ok(!isAdministratorRole("BUYER"));
    assert.ok(!isAdministratorRole("SELLER"));
  });

  it("an ADMIN who is banned or deactivated is denied", async () => {
    seed({ role: "ADMIN", isBanned: true });
    const { requireAdministrator } = await loadAuth();
    assert.equal(await captureRedirect(() => requireAdministrator()), "/");

    seed({ role: "ADMIN", isActive: false });
    assert.equal(await captureRedirect(() => requireAdministrator()), "/");
  });

  it("an ADMIN who has not finished onboarding goes to /complete-profile, not to /admin", async () => {
    seed({ role: "ADMIN", onboarded: false });
    const { requireAdministrator } = await loadAuth();

    assert.equal(await captureRedirect(() => requireAdministrator()), "/complete-profile");
  });

  it("a valid session with no application row is a repair path, not admin access", async () => {
    // Seeded nothing — identity authenticates, but no `users` row maps to it.
    const { requireAdministrator } = await loadAuth();

    assert.equal(await captureRedirect(() => requireAdministrator()), "/complete-profile");
  });
});

describe("requireAdministratorAction — the gate inside every admin mutation", () => {
  it("unauthenticated callers get a refusal, not an effect (test 1, 7)", async () => {
    provider.session = null;
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, false);
  });

  it("BUYER callers are refused (test 2, 7)", async () => {
    seed({ role: "BUYER" });
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /administrator/i);
  });

  it("SELLER callers are refused (test 3)", async () => {
    seed({ role: "SELLER", hasSellerProfile: true });
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /administrator/i);
  });

  it("ADMIN callers resolve with their own session identity (test 4)", async () => {
    seed({ role: "ADMIN" });
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, ADMIN_ID);
      assert.equal(result.user.role, "ADMIN");
    }
  });

  it("SUPER_ADMIN callers resolve the same way (test 5)", async () => {
    seed({ role: "SUPER_ADMIN" });
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.user.role, "SUPER_ADMIN");
  });

  it("banned admins are refused at the action layer too", async () => {
    seed({ role: "ADMIN", isBanned: true });
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /contact support/i);
  });

  it("role is read from the database, not the session — an unmapped role cannot be assumed", async () => {
    // The identity fixture says the session is valid; the ROW says BUYER.
    // Nothing a client sends can make the guard see an admin.
    seed({ role: "BUYER" });
    const { requireAdministratorAction } = await loadAuth();

    const result = await requireAdministratorAction();
    assert.equal(result.ok, false);
  });
});
