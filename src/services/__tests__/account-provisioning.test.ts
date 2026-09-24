import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthServiceError,
  authIdentityFromSupabaseUser,
  dashboardFor,
  decideProfileRole,
  ensureApplicationAccount,
  getApplicationAccountState,
  saveCompletedProfile,
} from "@/services/account-provisioning";
import type { CompleteProfileInput } from "@/lib/validations/auth";
import {
  FakePrismaError,
  createFakeAccountStore,
  seedAccount,
  type FakeAccountStore,
} from "./helpers/fake-account-store";

/**
 * Behavior tests for the authoritative account layer (pure, store-injected).
 *
 * The fake store mirrors the Postgres semantics these flows depend on
 * (unique email/phone → P2002, missing-row update → P2025, transaction
 * rollback), so the tests exercise the REAL logic against realistic database
 * behavior — not implementation details.
 */

const IDENTITY = authIdentityFromSupabaseUser({
  id: "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d",
  email: "emmanuel@example.com",
  phone: null,
  email_confirmed_at: "2026-09-20T08:15:00.000Z",
  user_metadata: { full_name: "Emmanuel Yegon" },
});

const INPUT: CompleteProfileInput = {
  fullName: "Emmanuel Yegon",
  phone: "+254726090372",
  county: "Uasin Gishu",
  accountIntent: "BOTH",
  avatarUrl: "",
};

function asStore(store: FakeAccountStore) {
  return store as unknown as Parameters<typeof saveCompletedProfile>[0];
}

describe("canonical account state (getApplicationAccountState)", () => {
  let store: FakeAccountStore;
  beforeEach(() => {
    store = createFakeAccountStore();
  });

  it("returns ACCOUNT_EXISTS with authoritative role/onboarding/seller state", async () => {
    seedAccount(store, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      role: "SELLER",
      onboarded: true,
      seller: { businessName: "Yegon Electronics", county: "Uasin Gishu" },
    });

    const result = await getApplicationAccountState(asStore(store), IDENTITY.id);

    assert.equal(result.status, "EXISTS");
    assert.deepEqual(result.state, {
      userId: IDENTITY.id,
      exists: true,
      role: "SELLER",
      onboarded: true,
      hasSellerProfile: true,
      profile: { fullName: "Test User", avatarUrl: null, county: null },
    });
  });

  it("returns ACCOUNT_MISSING (never an error, never a fabricated onboarded=true) for an unknown user", async () => {
    const result = await getApplicationAccountState(asStore(store), "11111111-2222-3333-4444-555555555555");

    assert.equal(result.status, "MISSING");
    assert.deepEqual(result.state, {
      userId: "11111111-2222-3333-4444-555555555555",
      exists: false,
      role: "BUYER",
      onboarded: false,
      hasSellerProfile: false,
      profile: null,
    });
  });

  it("treats a users row without a profile row as incomplete (onboarded=false), not onboarded", async () => {
    store.tables.users.set(IDENTITY.id, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      phone: null,
      role: "BUYER",
      emailVerified: true,
    });

    const result = await getApplicationAccountState(asStore(store), IDENTITY.id);

    assert.equal(result.status, "EXISTS");
    assert.equal(result.state.onboarded, false);
    assert.equal(result.state.profile, null);
  });

  it("propagates database failures — it never converts them into onboarded=false", async () => {
    store.failAll(new FakePrismaError("P1001", "Request timed out"));

    await assert.rejects(
      () => getApplicationAccountState(asStore(store), IDENTITY.id),
      (error: unknown) => error instanceof FakePrismaError && error.code === "P1001",
    );
  });
});

describe("provisioning boundary (ensureApplicationAccount)", () => {
  let store: FakeAccountStore;
  beforeEach(() => {
    store = createFakeAccountStore();
  });

  it("creates users + profiles rows for a fresh identity, in one transaction", async () => {
    const state = await ensureApplicationAccount(asStore(store), IDENTITY);

    assert.equal(store.tables.users.size, 1);
    assert.equal(store.tables.profiles.size, 1);
    assert.equal(store.tables.users.get(IDENTITY.id)?.email, IDENTITY.email);
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "BUYER");
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.onboarded, false);

    assert.deepEqual(state, {
      userId: IDENTITY.id,
      exists: true,
      role: "BUYER",
      onboarded: false,
      hasSellerProfile: false,
      profile: { fullName: "Emmanuel Yegon", avatarUrl: null, county: null },
    });

    // Exactly one transaction containing the three statements — no separate
    // follow-up lookup.
    const txnStatements = store.statements;
    assert.deepEqual(txnStatements, [
      `user.upsert:${IDENTITY.id}`,
      `profile.upsert:${IDENTITY.id}`,
      `seller.findUnique:${IDENTITY.id}`,
    ]);
  });

  it("is idempotent and never clobbers user-set phone/role/name", async () => {
    seedAccount(store, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      phone: "0712345678",
      role: "SELLER",
      onboarded: true,
      fullName: "Emmanuel K. Yegon",
      county: "Nairobi",
    });

    const state = await ensureApplicationAccount(asStore(store), IDENTITY);

    assert.equal(store.tables.users.size, 1);
    assert.equal(store.tables.profiles.size, 1);
    assert.equal(store.tables.users.get(IDENTITY.id)?.phone, "0712345678");
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "SELLER");
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.fullName, "Emmanuel K. Yegon");
    assert.equal(state.onboarded, true);
    assert.equal(state.role, "SELLER");
  });

  it("may confirm an email address, but never un-confirm one", async () => {
    seedAccount(store, { id: IDENTITY.id, email: IDENTITY.email });
    store.tables.users.get(IDENTITY.id)!.emailVerified = true;
    // Supabase user now appears unconfirmed (stale identity read).
    const unconfirmed = { ...IDENTITY, emailVerified: false };
    await ensureApplicationAccount(asStore(store), unconfirmed);
    assert.equal(store.tables.users.get(IDENTITY.id)?.emailVerified, true);
  });

  it("provisions whichever of the two rows is missing", async () => {
    store.tables.users.set(IDENTITY.id, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      phone: null,
      role: "BUYER",
      emailVerified: true,
    });

    const state = await ensureApplicationAccount(asStore(store), IDENTITY);

    assert.equal(store.tables.profiles.size, 1);
    assert.equal(state.exists, true);
  });

  it("never grants a role above BUYER at provisioning time", async () => {
    const state = await ensureApplicationAccount(asStore(store), IDENTITY);
    assert.equal(state.role, "BUYER");
  });

  it("rejects an identity without an email (user-accountable)", async () => {
    await assert.rejects(
      () => ensureApplicationAccount(asStore(store), { ...IDENTITY, email: "" }),
      (error: unknown) => error instanceof AuthServiceError,
    );
  });

  it("propagates connection-class database failures for the caller to classify", async () => {
    store.failAll(new FakePrismaError("P1002", "Can't reach database API"));

    await assert.rejects(
      () => ensureApplicationAccount(asStore(store), IDENTITY),
      (error: unknown) => error instanceof FakePrismaError && error.code === "P1002",
    );
    assert.equal(store.tables.users.size, 0, "nothing was written");
  });

  it("rolls the whole transaction back on a mid-write failure", async () => {
    // profile.upsert fails after user.upsert succeeded.
    store.enqueueFailures(new FakePrismaError("P2024", "db error"), 1);
    // First statement (user.upsert) succeeds; second (profile.upsert) fails.
    // We need user.upsert to succeed first — enqueue consumes in order, so
    // the user upsert consumes the failure. Instead make the PROFILE op fail:
    store.resetFailures();
    const originalProfileUpsert = store.profile.upsert.bind(store.profile);
    store.profile.upsert = async (args) => {
      store.statements.push(`profile.upsert:${args.where.userId}`);
      throw new FakePrismaError("P2024", "forced profile failure");
    };

    await assert.rejects(
      () => ensureApplicationAccount(asStore(store), IDENTITY),
      (error: unknown) => error instanceof FakePrismaError,
    );

    // The user row created inside the transaction must be rolled back.
    assert.equal(store.tables.users.size, 0);
    assert.equal(store.tables.profiles.size, 0);
    void originalProfileUpsert;
  });
});

describe("role rules (decideProfileRole)", () => {
  it("keeps ADMIN and SUPER_ADMIN untouched, no matter the intent", () => {
    assert.equal(decideProfileRole("ADMIN", true), "ADMIN");
    assert.equal(decideProfileRole("ADMIN", false), "ADMIN");
    assert.equal(decideProfileRole("SUPER_ADMIN", true), "SUPER_ADMIN");
    assert.equal(decideProfileRole("SUPER_ADMIN", false), "SUPER_ADMIN");
  });

  it("never downgrades an existing SELLER", () => {
    assert.equal(decideProfileRole("SELLER", true), "SELLER");
    assert.equal(decideProfileRole("SELLER", false), "SELLER");
  });

  it("promotes a BUYER to SELLER only when selling is wanted", () => {
    assert.equal(decideProfileRole("BUYER", true), "SELLER");
    assert.equal(decideProfileRole("BUYER", false), "BUYER");
  });
});

describe("onboarding write (saveCompletedProfile)", () => {
  let store: FakeAccountStore;
  beforeEach(() => {
    store = createFakeAccountStore();
  });

  it("completes a first-ever profile for an unprovisioned user (the P2025 regression)", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, INPUT);

    assert.deepEqual(result.role, "SELLER");
    assert.equal(result.wantsToSell, true);
    assert.equal(result.state.onboarded, true);
    assert.equal(result.state.hasSellerProfile, true);
    assert.equal(store.tables.users.get(IDENTITY.id)?.phone, "+254726090372");
    assert.equal(store.tables.sellers.size, 1);
  });

  it("saves a buyer profile without creating a Seller row", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...INPUT,
      accountIntent: "BUYER",
    });

    assert.equal(result.role, "BUYER");
    assert.equal(result.state.hasSellerProfile, false);
    assert.equal(store.tables.sellers.size, 0);
  });

  it("preserves an existing ADMIN role AND refuses to grant seller state from the form", async () => {
    seedAccount(store, { id: IDENTITY.id, email: IDENTITY.email, role: "ADMIN", onboarded: true });

    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...INPUT,
      accountIntent: "SELLER",
    });

    assert.equal(result.role, "ADMIN");
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "ADMIN");
    // Privileged roles keep their access grants out of the onboarding form's
    // reach: no Seller row is created, and the state reflects that.
    assert.equal(result.state.hasSellerProfile, false);
    assert.equal(store.tables.sellers.size, 0);
  });

  it("an ADMIN who already holds a Seller row (granted out-of-band) keeps it — rows are never deleted", async () => {
    seedAccount(store, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      role: "ADMIN",
      onboarded: true,
      seller: { businessName: "Support" },
    });

    const result = await saveCompletedProfile(asStore(store), IDENTITY, INPUT);

    assert.equal(result.role, "ADMIN");
    assert.equal(result.state.hasSellerProfile, true, "existing row is reflected, not removed");
    assert.equal(store.tables.sellers.size, 1);
  });

  it("preserves an existing SUPER_ADMIN role (and grants no seller state)", async () => {
    seedAccount(store, { id: IDENTITY.id, email: IDENTITY.email, role: "SUPER_ADMIN", onboarded: true });

    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...INPUT,
      accountIntent: "BOTH",
    });

    assert.equal(result.role, "SUPER_ADMIN");
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "SUPER_ADMIN");
    assert.equal(result.state.hasSellerProfile, false);
    assert.equal(store.tables.sellers.size, 0);
  });

  it("keeps an existing SELLER a SELLER even when the intent is BUYER", async () => {
    seedAccount(store, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      role: "SELLER",
      onboarded: true,
      seller: { businessName: "Yegon Electronics" },
    });

    const result = await saveCompletedProfile(asStore(store), IDENTITY, {
      ...INPUT,
      accountIntent: "BUYER",
    });

    assert.equal(result.role, "SELLER");
    assert.equal(store.tables.users.get(IDENTITY.id)?.role, "SELLER");
    // The Seller row is never deleted.
    assert.equal(store.tables.sellers.size, 1);
    assert.equal(store.tables.sellers.get(IDENTITY.id)?.businessName, "Yegon Electronics");
  });

  it("keeps an existing Seller row instead of creating a second one", async () => {
    seedAccount(store, {
      id: IDENTITY.id,
      email: IDENTITY.email,
      role: "SELLER",
      seller: { businessName: "Yegon Electronics", slug: "yegon-electronics-ab12c" },
    });

    const result = await saveCompletedProfile(asStore(store), IDENTITY, INPUT);

    assert.equal(store.tables.sellers.size, 1);
    assert.equal(store.tables.sellers.get(IDENTITY.id)?.businessName, "Yegon Electronics");
    assert.equal(result.state.hasSellerProfile, true);
  });

  it("rejects a phone number claimed by another account and rolls back the whole write", async () => {
    seedAccount(store, {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: "other@example.com",
      phone: INPUT.phone,
    });

    await assert.rejects(
      () => saveCompletedProfile(asStore(store), IDENTITY, INPUT),
      (error: unknown) =>
        error instanceof AuthServiceError &&
        error.message === "That phone number is already linked to another MaliHub account.",
    );

    assert.equal(store.tables.users.get(IDENTITY.id), undefined);
    assert.equal(store.tables.profiles.get(IDENTITY.id), undefined);
    assert.equal(store.tables.sellers.size, 0);
  });

  it("propagates a P2002 phone-unique race (both writers passed the pre-check) as a raw database error, rolled back", async () => {
    // Simulates the race the pre-check cannot close: two concurrent
    // completions both pass the findFirst check, and the second
    // `user.update` hits the unique index. The service must NOT wrap this in
    // AuthServiceError — it propagates raw so the action's classifier
    // (which maps P2002 to the "already linked" copy) handles it.
    seedAccount(store, { id: IDENTITY.id, email: IDENTITY.email });
    const originalUpdate = store.user.update.bind(store.user);
    store.user.update = async (args) => {
      if (args.data.phone) {
        throw new FakePrismaError("P2002", "Unique constraint failed on users.phone");
      }
      return originalUpdate(args);
    };

    await assert.rejects(
      () => saveCompletedProfile(asStore(store), IDENTITY, INPUT),
      (error: unknown) =>
        error instanceof FakePrismaError &&
        error.code === "P2002" &&
        error.name === "PrismaClientKnownRequestError",
    );

    // The transaction rolled back — the profile was not marked onboarded.
    assert.equal(store.tables.profiles.get(IDENTITY.id)?.onboarded, false);
    assert.equal(store.tables.sellers.size, 0);
  });

  it("returns the committed canonical state (no re-query needed)", async () => {
    const result = await saveCompletedProfile(asStore(store), IDENTITY, INPUT);

    // The state must reflect the transaction outcome directly.
    assert.equal(result.state.userId, IDENTITY.id);
    assert.equal(result.state.exists, true);
    assert.equal(result.state.onboarded, true);
    assert.equal(result.state.profile?.county, "Uasin Gishu");
    assert.equal(result.state.profile?.fullName, "Emmanuel Yegon");
  });
});

describe("authIdentityFromSupabaseUser", () => {
  it("reads the same metadata the Supabase trigger used to", () => {
    assert.deepEqual(authIdentityFromSupabaseUser({
      id: "id-1",
      email: "a@example.com",
      phone: "+254700000001",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      user_metadata: { full_name: "A B", avatar_url: "https://x.example/a.png" },
    }), {
      id: "id-1",
      email: "a@example.com",
      phone: "+254700000001",
      emailVerified: true,
      fullName: "A B",
      avatarUrl: "https://x.example/a.png",
    });
  });

  it("falls back to Google's name/avatar claims, then to empty name", () => {
    const google = authIdentityFromSupabaseUser({
      id: "id-2",
      email: "g@example.com",
      email_confirmed_at: null,
      user_metadata: { name: "Google User", avatar_url: "https://lh3.googleusercontent.com/a/x" },
    });
    assert.equal(google.fullName, "Google User");
    assert.equal(google.avatarUrl, "https://lh3.googleusercontent.com/a/x");
    assert.equal(google.emailVerified, false);

    const bare = authIdentityFromSupabaseUser({ id: "id-3", email: "b@example.com" });
    assert.equal(bare.fullName, "");
    assert.equal(bare.phone, null);
  });
});

describe("dashboardFor", () => {
  it("routes by the Seller row, not the role", () => {
    assert.equal(dashboardFor({ hasSellerProfile: true }), "/dashboard/seller");
    assert.equal(dashboardFor({ hasSellerProfile: false }), "/dashboard/buyer");
  });
});
