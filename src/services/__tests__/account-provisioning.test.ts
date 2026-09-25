import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthServiceError,
  ensureUserProvisioned,
  getAuthoritativeOnboardingState,
  readApplicationAccess,
  resolveApplicationUserId,
  saveCompletedProfile,
  type ProvisioningIdentity,
} from "@/services/account-provisioning";
import type { CompleteProfileInput } from "@/lib/validations/auth";

/**
 * These tests pin two things: the original production failure and its fix, and
 * the identity model the Neon Auth migration introduced.
 *
 * The shared fake store (`./fake-account-store`) mirrors the Postgres
 * semantics the code depends on:
 *  - `update`/`findUnique` on a row that does not exist throws Prisma's
 *    `P2025` ("record to update not found") — which is exactly what the
 *    onboarding action hit when the auth provider authenticated a user whose
 *    `users`/`profiles` rows had never been created in Neon;
 *  - `email`/`phone`/`auth_user_id` are unique, so a second claim raises
 *    `P2002`;
 *  - a failed `$transaction` rolls back every write inside it.
 *
 * ─── The identity model under test ─────────────────────────────────────────
 * The auth provider's id is NOT the application id. `users.id` stays
 * MaliHub-generated (it is the target of every foreign key in the schema), and
 * the provider id is mapped through the separate UNIQUE `users.auth_user_id`
 * column. So a test can never assume an application id up front — it must take
 * the one provisioning returns. That asymmetry is the whole point of the
 * migration and several assertions below exist specifically to hold it.
 */

import {
  PrismaKnownError,
  asAccountStore,
  createFakeAccountStore,
  seedLegacyRow,
  type FakeStore,
} from "./fake-account-store";

/**
 * The provider identity under test. Note what it does NOT contain: no
 * application user id, no role, no onboarding flag. Everything MaliHub
 * authorizes against is read from its own rows.
 */
const IDENTITY: ProvisioningIdentity = {
  authUserId: "neon-auth-user-9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d",
  email: "emmanuel@example.com",
  phone: null,
  emailVerified: true,
  fullName: "Emmanuel Yegon",
  avatarUrl: null,
};

/** A legacy row for the fixture identity: same email, no provider mapping. */
const LEGACY_OVERRIDES = { id: "legacy-0001", email: IDENTITY.email } as const;

const COMPLETE_INPUT: CompleteProfileInput = {
  fullName: "Emmanuel Yegon",
  phone: "+254726090372",
  county: "Uasin Gishu",
  accountIntent: "BOTH",
  avatarUrl: "",
};

const asStore = asAccountStore;


describe("authoritative onboarding state", () => {
  it("reads onboarded, role, and Seller existence from application rows", async () => {
    const store = createFakeAccountStore();
    const userId = await ensureUserProvisioned(asStore(store), IDENTITY);
    await store.user.update({ where: { id: userId }, data: { role: "SELLER" } });
    await store.profile.update({ where: { userId }, data: { onboarded: true } });
    store.tables.sellers.set(userId, {
      userId,
      businessName: "Yegon Electronics",
      slug: "yegon-electronics-ab12c",
      county: "Uasin Gishu",
    });

    assert.deepEqual(await getAuthoritativeOnboardingState(asStore(store), userId), {
      onboarded: true,
      role: "SELLER",
      hasSellerProfile: true,
    });
  });

  it("treats missing application rows as an incomplete BUYER without elevating access", async () => {
    const store = createFakeAccountStore();

    assert.deepEqual(await getAuthoritativeOnboardingState(asStore(store), "no-such-user"), {
      onboarded: false,
      role: "BUYER",
      hasSellerProfile: false,
    });

    const userId = await ensureUserProvisioned(asStore(store), IDENTITY);
    store.tables.profiles.clear();
    assert.deepEqual(await getAuthoritativeOnboardingState(asStore(store), userId), {
      onboarded: false,
      role: "BUYER",
      hasSellerProfile: false,
    });
  });

  it("reports a banned account through the access read, not through onboarding state", async () => {
    const store = createFakeAccountStore();
    const userId = await ensureUserProvisioned(asStore(store), IDENTITY);
    await store.user.update({ where: { id: userId }, data: { isBanned: true } });

    const access = await readApplicationAccess(asStore(store), userId);
    assert.ok(access);
    assert.equal(access.isBanned, true);
    // Onboarding state stays a separate concern: a banned user is still
    // "onboarded", and the guard layer is what refuses them.
    assert.deepEqual(await getAuthoritativeOnboardingState(asStore(store), userId), {
      onboarded: false,
      role: "BUYER",
      hasSellerProfile: false,
    });
  });

  it("returns null from the access read for an identity with no application row", async () => {
    const store = createFakeAccountStore();
    assert.equal(await readApplicationAccess(asStore(store), "no-such-user"), null);
  });
});

describe("identity mapping — auth id vs application id", () => {
  it("generates its own application id and stores the provider id separately", async () => {
    const store = createFakeAccountStore();
    const userId = await ensureUserProvisioned(asStore(store), IDENTITY);

    assert.notEqual(
      userId,
      IDENTITY.authUserId,
      "users.id must never be the provider's id — it is the target of every FK"
    );
    const row = store.tables.users.get(userId);
    assert.ok(row);
    assert.equal(row.authUserId, IDENTITY.authUserId);
    assert.equal(row.email, "emmanuel@example.com");
  });

  it("resolves the same application id on a second session for the same provider identity", async () => {
    const store = createFakeAccountStore();
    const first = await ensureUserProvisioned(asStore(store), IDENTITY);
    const second = await ensureUserProvisioned(asStore(store), IDENTITY);

    assert.equal(first, second);
    assert.equal(store.tables.users.size, 1, "a second sign-in must not create a second account");
  });

  it("refuses to provision an identity without a provider id", async () => {
    const store = createFakeAccountStore();
    await assert.rejects(
      () => ensureUserProvisioned(asStore(store), { ...IDENTITY, authUserId: "" }),
      (error: unknown) =>
        error instanceof AuthServiceError &&
        error.message === "Your sign-in didn't return an account reference. Please try again."
    );
    assert.equal(store.tables.users.size, 0);
  });

  it("refuses to provision an identity without an email address", async () => {
    const store = createFakeAccountStore();
    await assert.rejects(
      () => ensureUserProvisioned(asStore(store), { ...IDENTITY, email: "" }),
      (error: unknown) => error instanceof AuthServiceError
    );
    assert.equal(store.tables.users.size, 0);
  });
});

describe("legacy account linking", () => {
  it("refuses to create a second account for an unmapped legacy email by default", async () => {
    const store = createFakeAccountStore();
    seedLegacyRow(store, LEGACY_OVERRIDES);

    await assert.rejects(
      () => resolveApplicationUserId(asStore(store), IDENTITY),
      (error: unknown) =>
        error instanceof AuthServiceError &&
        error.message ===
          "That email is already linked to a MaliHub account that hasn't been moved to the new sign-in system yet. Please contact support."
    );
    assert.equal(store.tables.users.size, 1, "no duplicate account was created");
  });

  it("claims an unmapped legacy row when linking is explicitly enabled", async () => {
    const store = createFakeAccountStore();
    const legacy = seedLegacyRow(store, LEGACY_OVERRIDES);

    const resolved = await resolveApplicationUserId(asStore(store), IDENTITY, {
      linkUnmappedByEmail: true,
    });

    assert.equal(resolved.id, legacy.id, "the legacy application id is kept");
    assert.equal(resolved.role, "SELLER", "the legacy role is kept, not reset");
    assert.equal(
      store.tables.users.get(legacy.id)?.authUserId,
      IDENTITY.authUserId,
      "the mapping column is filled in"
    );
    assert.equal(store.tables.users.size, 1);
  });

  it("never claims a row that already belongs to a different provider identity", async () => {
    const store = createFakeAccountStore();
    seedLegacyRow(store, { ...LEGACY_OVERRIDES, authUserId: "some-other-provider-id" });

    await assert.rejects(
      () =>
        resolveApplicationUserId(asStore(store), IDENTITY, { linkUnmappedByEmail: true }),
      (error: unknown) =>
        error instanceof AuthServiceError &&
        error.message === "An account with that email already exists. Try signing in instead."
    );

    assert.equal(
      store.tables.users.get("legacy-0001")?.authUserId,
      "some-other-provider-id",
      "an account is never reassigned — that would be a takeover path"
    );
  });

  it("leaves a legacy row alone entirely when linking is disabled", async () => {
    const store = createFakeAccountStore();
    seedLegacyRow(store, LEGACY_OVERRIDES);

    await assert.rejects(() => resolveApplicationUserId(asStore(store), IDENTITY));
    assert.equal(store.tables.users.get("legacy-0001")?.authUserId, null);
  });
});

describe("account provisioning — freshly initialized database", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = createFakeAccountStore();
  });

  it("fails the way production failed when the rows were never provisioned (regression guard)", async () => {
    // No provisioning step: this is the pre-fix behaviour — the action updated
    // rows that a provider-only signup never created in this database.
    await assert.rejects(
      () => store.user.update({ where: { id: "never-provisioned" }, data: { phone: "+254726090372" } }),
      (error: unknown) =>
        error instanceof PrismaKnownError &&
        error.code === "P2025" &&
        error.name === "PrismaClientKnownRequestError"
    );
    await assert.rejects(
      () =>
        store.profile.update({ where: { userId: "never-provisioned" }, data: { onboarded: true } }),
      (error: unknown) => error instanceof PrismaKnownError && error.code === "P2025"
    );
  });

  it("completes the first-ever profile save for an authenticated user with no rows", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);

    assert.equal(result.role, "SELLER");
    assert.equal(result.wantsToSell, true);

    const userId = result.userId;
    const user = store.tables.users.get(userId);
    assert.ok(user, "the users row is created");
    assert.equal(user.email, "emmanuel@example.com");
    assert.equal(user.authUserId, IDENTITY.authUserId);
    assert.equal(user.phone, "+254726090372");
    assert.equal(user.role, "SELLER");
    assert.equal(user.emailVerified, true);

    const profile = store.tables.profiles.get(userId);
    assert.ok(profile, "the profiles row is created");
    assert.equal(profile.fullName, "Emmanuel Yegon");
    assert.equal(profile.county, "Uasin Gishu");
    assert.equal(profile.onboarded, true);

    const seller = store.tables.sellers.get(userId);
    assert.ok(seller, "a starter Seller row is created for accountIntent BOTH");
    assert.equal(seller.businessName, "Emmanuel Yegon");
    assert.equal(seller.county, "Uasin Gishu");
    assert.match(seller.slug, /^emmanuel-yegon-/);
  });

  it("provisions the rows before it updates them (the ordering the fix depends on)", async () => {
    const { userId } = await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);

    const provisionedAt = store.operations.indexOf(`user.create:${IDENTITY.authUserId}`);
    const updatedAt = store.operations.indexOf(`user.update:${userId}`);
    const profileProvisionedAt = store.operations.indexOf(`profile.upsert:${userId}`);
    const profileUpdatedAt = store.operations.indexOf(`profile.update:${userId}`);

    assert.ok(
      provisionedAt >= 0 && updatedAt >= 0 && profileProvisionedAt >= 0 && profileUpdatedAt >= 0,
      `expected every write to be recorded, got: ${store.operations.join(", ")}`
    );
    assert.ok(provisionedAt < updatedAt, "users row is created before it is updated");
    assert.ok(profileProvisionedAt < profileUpdatedAt, "profiles row is created before it is updated");
  });

  it("saves a buyer profile without creating a Seller row", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...COMPLETE_INPUT,
      accountIntent: "BUYER",
    });

    assert.equal(result.role, "BUYER");
    assert.equal(result.wantsToSell, false);
    assert.equal(store.tables.users.get(result.userId)?.role, "BUYER");
    assert.equal(store.tables.sellers.size, 0);
  });

  it("provisions whichever of the two rows is missing", async () => {
    // users row exists, profiles row does not (a partially provisioned account)
    const userId = await ensureUserProvisioned(asStore(store), IDENTITY);
    store.tables.profiles.clear();

    await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);
    assert.equal(store.tables.profiles.get(userId)?.onboarded, true);

    // users row gone entirely — provisioning recreates it rather than failing
    // on the dangling reference, because resolution runs before any update.
    const second = createFakeAccountStore();
    const other: ProvisioningIdentity = {
      ...IDENTITY,
      authUserId: "neon-auth-user-11111111-2222-3333-4444-555555555555",
      email: "other@example.com",
    };
    await ensureUserProvisioned(asStore(second), other);
    second.tables.users.clear();

    const saved = await saveCompletedProfile(asStore(second), other, COMPLETE_INPUT);
    const recreated = second.tables.users.get(saved.userId);
    assert.ok(recreated, "the users row is recreated instead of throwing P2025");
    assert.equal(recreated.authUserId, other.authUserId);
    assert.equal(recreated.role, "SELLER");
    assert.equal(second.tables.profiles.get(saved.userId)?.onboarded, true);
  });
});

describe("account provisioning — existing accounts", () => {
  let store: FakeStore;
  let userId: string;

  beforeEach(async () => {
    store = createFakeAccountStore();
    userId = await ensureUserProvisioned(asStore(store), IDENTITY);
  });

  it("is idempotent and never clobbers a phone, role or name the user already set", async () => {
    store.tables.users.set(userId, {
      id: userId,
      email: "emmanuel@example.com",
      authUserId: IDENTITY.authUserId,
      phone: "0712345678",
      role: "SELLER",
      isActive: true,
      isBanned: false,
      emailVerified: true,
    });
    store.tables.profiles.set(userId, {
      userId,
      fullName: "Emmanuel K. Yegon",
      avatarUrl: "https://cdn.example.com/a.png",
      county: "Nairobi",
      onboarded: true,
    });

    await ensureUserProvisioned(asStore(store), IDENTITY);

    assert.equal(store.tables.users.size, 1);
    assert.equal(store.tables.profiles.size, 1);
    assert.equal(store.tables.users.get(userId)?.phone, "0712345678");
    assert.equal(store.tables.users.get(userId)?.role, "SELLER");
    assert.equal(store.tables.profiles.get(userId)?.fullName, "Emmanuel K. Yegon");
    assert.equal(store.tables.profiles.get(userId)?.county, "Nairobi");
  });

  it("confirms an email address but never un-confirms one", async () => {
    await store.user.update({ where: { id: userId }, data: { emailVerified: true } });
    // `undefined` means "leave as-is" in Prisma; a false flag must not be
    // written over a verified address just because a session payload omitted it.
    await ensureUserProvisioned(asStore(store), { ...IDENTITY, emailVerified: false });

    assert.equal(store.tables.users.get(userId)?.emailVerified, true);
  });

  it("keeps an existing Seller row instead of creating a second one", async () => {
    store.tables.sellers.set(userId, {
      userId,
      businessName: "Yegon Electronics",
      slug: "yegon-electronics-ab12c",
      county: "Uasin Gishu",
    });

    await saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT);

    assert.equal(store.tables.sellers.size, 1);
    assert.equal(store.tables.sellers.get(userId)?.businessName, "Yegon Electronics");
  });

  it("completes a returning user's profile", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...COMPLETE_INPUT,
      accountIntent: "SELLER",
    });

    assert.equal(result.role, "SELLER");
    assert.equal(result.wantsToSell, true);
    assert.equal(result.userId, userId);
    assert.equal(store.tables.profiles.get(userId)?.onboarded, true);
    assert.equal(store.tables.profiles.get(userId)?.county, "Uasin Gishu");
  });

  it("rejects a phone number that belongs to another account and rolls the write back", async () => {
    const taken: ProvisioningIdentity = {
      ...IDENTITY,
      authUserId: "neon-auth-user-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: "other@example.com",
    };
    const takenId = await ensureUserProvisioned(asStore(store), taken);
    await store.user.update({ where: { id: takenId }, data: { phone: "+254726090372" } });

    await assert.rejects(
      () => saveCompletedProfile(asStore(store), IDENTITY, COMPLETE_INPUT),
      (error: unknown) =>
        error instanceof AuthServiceError &&
        error.message === "That phone number is already linked to another MaliHub account."
    );

    // The transaction rolled back: nothing was partially written.
    assert.equal(store.tables.users.get(userId)?.role, "BUYER");
    assert.equal(store.tables.users.get(userId)?.phone, null);
    assert.equal(store.tables.profiles.get(userId)?.onboarded, false);
    assert.equal(store.tables.sellers.size, 0, "no Seller row survived the rollback");
  });
});
