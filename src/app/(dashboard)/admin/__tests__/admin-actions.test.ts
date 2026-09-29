import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

import { installAuthActionMocks, makeIdentity } from "@/lib/auth/__tests__/provider-mock";
import {
  createFakeAdminStore,
  seedProduct,
  seedProfile,
  seedSeller,
  seedUser,
} from "@/services/__tests__/fake-admin-store";
import type { FakeStore } from "@/services/__tests__/fake-account-store";

/**
 * End-to-end authorization over the admin Server Actions — the only write
 * surface the dashboard has.
 *
 * Why actions and not just pages: a Server Action is a POST endpoint. A
 * BUYER who never renders `/admin` can still call `verifySellerAction`
 * directly with a captured request. The page guard (`requireAdministrator`
 * in the layout) is convenience; the guard inside every action
 * (`requireAdministratorAction`) is the actual boundary. This suite attacks
 * that boundary as an attacker would:
 *
 *   - non-admin sessions calling each mutation (expect refusal + zero writes)
 *   - banned/deactivated ADMIN sessions (account state beats role state)
 *   - forged target ids smuggled into otherwise-valid payloads (zod UUID +
 *     service-level "not found" — the client never controls what gets
 *     written, only *what it hopes* gets written)
 *   - and the surface itself: the export list is pinned, so "an admin can
 *     cancel orders / edit payouts / change roles from the dashboard" stays
 *     structurally impossible rather than merely hidden.
 *
 * Everything from the actions downward is real code (guard → zod →
 * AdminService → audit/notification writes) against the in-memory admin
 * store; only the auth provider, `next/cache`, and the database are mocked.
 */

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const store = createFakeAdminStore();
const provider = installAuthActionMocks(store as unknown as FakeStore);

let actions: typeof import("@/app/(dashboard)/admin/actions") | null = null;
async function loadActions() {
  actions ??= await import("@/app/(dashboard)/admin/actions");
  return actions;
}

const PENDING_SELLER_ID = "77777777-1111-4111-8111-111111111111";
const PENDING_LISTING_ID = "88888888-2222-4222-8222-222222222222";

/** Seed the seller/listing pair every permission test aims at. */
function targetFixture() {
  const sellerOwner = seedUser(store, { id: "66666666-0000-4000-8000-000000000001", email: "sara@mama-nairobi.co.ke", role: "SELLER" });
  seedProfile(store, { userId: sellerOwner.id, fullName: "Sara Wanjiru" });
  const seller = seedSeller(store, {
    id: PENDING_SELLER_ID,
    userId: sellerOwner.id,
    businessName: "Mama Nitende Crafts",
    verificationStatus: "PENDING",
  });
  const category = { id: "99999999-0000-4000-8000-000000000001" };
  store.tables.categories.set(category.id, {
    id: category.id,
    name: "Furniture",
    slug: "furniture",
    isActive: true,
    parentId: null,
  });
  const listing = seedProduct(store, {
    id: PENDING_LISTING_ID,
    sellerId: seller.id,
    ownerId: sellerOwner.id,
    categoryId: category.id,
    title: "Reclaimed coffee table",
    status: "PENDING_REVIEW",
  });
  return { sellerOwner, seller, listing };
}

function become(user: { role?: string } = {}, overrides: { isBanned?: boolean; isActive?: boolean } = {}) {
  const admin = seedUser(store, {
    id: "55555555-0000-4000-8000-000000000001",
    email: "admin@malihub.co.ke",
    role: user.role ?? "ADMIN",
    authUserId: makeIdentity().authUserId,
    ...overrides,
  });
  seedProfile(store, { userId: admin.id, fullName: "Ops Admin" });
  provider.session = makeIdentity();
  return admin;
}

beforeEach(() => {
  provider.reset();
  for (const table of Object.values(store.tables)) table.clear();
  store.operations.length = 0;
});

describe("seller review actions — permission and payload attacks", () => {
  it("a BUYER calling verifySellerAction is refused and nothing is written (tests 2, 6, 7)", async () => {
    const { seller } = targetFixture();
    become({ role: "BUYER" });
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: seller.id });

    assert.equal(result.success, false);
    assert.equal(result.error, "Administrator access is required.");
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "PENDING");
    assert.deepEqual(
      store.operations.filter((op) => /create|update|delete|upsert/.test(op)),
      [],
      "refusal must happen before any DB write or side effect"
    );
  });

  it("an anonymous POST is refused (test 1)", async () => {
    const { seller } = targetFixture();
    provider.session = null;
    const { rejectSellerAction } = await loadActions();

    const result = await rejectSellerAction({ sellerId: seller.id });

    assert.equal(result.success, false);
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "PENDING");
    assert.deepEqual(
      store.operations.filter((op) => /create|update|delete|upsert/.test(op)),
      []
    );
  });

  it("a BANNED admin session is refused before the role is even consulted", async () => {
    const { seller } = targetFixture();
    become({}, { isBanned: true });
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: seller.id });

    assert.equal(result.success, false);
    assert.match(result.error!, /contact support/i);
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "PENDING");
  });

  it("a DEACTIVATED admin session is refused (isActive is checked, not just isBanned)", async () => {
    const { seller } = targetFixture();
    become({}, { isActive: false });
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: seller.id });

    assert.equal(result.success, false);
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "PENDING");
    assert.deepEqual(
      store.operations.filter((op) => /create|update|delete|upsert/.test(op)),
      []
    );
  });

  it("an ADMIN's verification lands: row, notification, and audit naming the session user (test 4, 12)", async () => {
    const { seller, sellerOwner } = targetFixture();
    const admin = become();
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: seller.id, note: "Documents match." });

    assert.equal(result.success, true);
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "VERIFIED");

    const audit = [...store.tables.auditLogs.values()];
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actorId, admin.id, "audit actor comes from the session, never the payload");
    assert.equal(audit[0]!.action, "moderation.seller_verified");
    assert.equal((audit[0]!.metadata as { note?: string } | null)?.note, "Documents match.");

    const notification = [...store.tables.notifications.values()];
    assert.equal(notification.length, 1);
    assert.equal(notification[0]!.userId, sellerOwner.id);
    assert.match(String(notification[0]!.body), /Documents match\./, "the note reaches the seller");
  });

  it("a SUPER_ADMIN acts with the same reach as an ADMIN — no extra doors (test 5)", async () => {
    const { seller } = targetFixture();
    become({ role: "SUPER_ADMIN" });
    const { rejectSellerAction } = await loadActions();

    const result = await rejectSellerAction({ sellerId: seller.id, note: "KRA PIN does not match." });

    assert.equal(result.success, true);
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "REJECTED");
  });

  it("a non-UUID sellerId in an otherwise valid payload never reaches Prisma", async () => {
    become();
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: "../admin" });

    assert.equal(result.success, false);
    assert.equal(result.error, "Invalid request.");
  });

  it("a UUID that is a USER id, not a seller id, fails as not-found — no blind update", async () => {
    targetFixture();
    become();
    const { verifySellerAction } = await loadActions();

    const victimUserId = "66666666-0000-4000-8000-000000000001";
    const result = await verifySellerAction({ sellerId: victimUserId });

    assert.equal(result.success, false);
    assert.match(result.error!, /not found/i);
    assert.deepEqual(
      store.operations.filter((op) => op.startsWith("seller.update") || op.startsWith("auditLog.create")),
      []
    );
  });

  it("an invalid transition is refused with the honest reason, even from an admin", async () => {
    targetFixture();
    become();
    // Pre-approve directly so the target is already VERIFIED (admin row not needed for seeding).
    store.tables.sellers.get(PENDING_SELLER_ID)!.verificationStatus = "VERIFIED";
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: PENDING_SELLER_ID });

    assert.equal(result.success, false);
    assert.match(result.error!, /already verified/i);
  });
});

describe("listing moderation action", () => {
  it("a SELLER cannot moderate any listing — including their own, through the admin action", async () => {
    const { listing } = targetFixture();
    // The acting session IS the listing's owner, just not an admin.
    seedUser(store, {
      id: "66666666-0000-4000-8000-000000000001",
      email: "sara@mama-nairobi.co.ke",
      role: "SELLER",
      authUserId: makeIdentity().authUserId,
    });
    provider.session = makeIdentity();
    const { moderateListingAction } = await loadActions();

    const result = await moderateListingAction({ productId: listing.id, action: "approve" });

    assert.equal(result.success, false);
    assert.equal(result.error, "Administrator access is required.");
    assert.equal(store.tables.products.get(listing.id)!.status, "PENDING_REVIEW");
  });

  it("an ADMIN approval publishes, stamps publishedAt, notifies the owner, and audits (test 4 with real effects)", async () => {
    const { listing, sellerOwner } = targetFixture();
    const admin = become();
    const { moderateListingAction } = await loadActions();

    const result = await moderateListingAction({ productId: listing.id, action: "approve", note: "Welcome aboard." });

    assert.equal(result.success, true);
    const row = store.tables.products.get(listing.id)!;
    assert.equal(row.status, "ACTIVE");
    assert.ok(row.publishedAt instanceof Date, "approved listings carry a published timestamp");
    assert.equal([...store.tables.notifications.values()][0]!.userId, sellerOwner.id);
    assert.equal([...store.tables.auditLogs.values()][0]!.actorId, admin.id);
  });

  it("a buyer calling the moderation endpoint with a forged productId is refused pre-write (test 7, 9)", async () => {
    const { listing } = targetFixture();
    become({ role: "BUYER" });
    const { moderateListingAction } = await loadActions();

    const result = await moderateListingAction({
      productId: listing.id,
      action: "reject",
      note: "Ignore this — I am not an admin.",
    });

    assert.equal(result.success, false);
    assert.equal(store.tables.products.get(listing.id)!.status, "PENDING_REVIEW");
    assert.equal(store.tables.auditLogs.size, 0);
  });

  it("an unknown action verb is rejected by validation, not by the database", async () => {
    const { listing } = targetFixture();
    become();
    const { moderateListingAction } = await loadActions();

    const result = await moderateListingAction({ productId: listing.id, action: "delete" });

    assert.equal(result.success, false);
    assert.equal(result.error, "Invalid request.");
  });
});

describe("category actions", () => {
  it("a BUYER cannot create categories (test 7)", async () => {
    become({ role: "BUYER" });
    const { createCategoryAction } = await loadActions();

    const result = await createCategoryAction({ name: "Secret Stash" });

    assert.equal(result.success, false);
    assert.equal(store.tables.categories.size, 0);
    assert.deepEqual(
      store.operations.filter((op) => /create|update|delete|upsert/.test(op)),
      []
    );
  });

  it("an ADMIN creation writes the row and the audit trail (test 4)", async () => {
    const admin = become();
    const { createCategoryAction } = await loadActions();

    const result = await createCategoryAction({ name: "Boda Parts" });

    assert.equal(result.success, true);
    assert.equal(store.tables.categories.size, 1);
    const row = [...store.tables.categories.values()][0]!;
    assert.equal(row.slug, "boda-parts", "slug derived server-side from the name");
    assert.equal([...store.tables.auditLogs.values()][0]!.actorId, admin.id);
    assert.equal([...store.tables.auditLogs.values()][0]!.action, "admin.category_created");
  });

  it("duplicate slugs surface as a conflict, and deletion in use is refused", async () => {
    targetFixture();
    become();
    const { createCategoryAction, deleteCategoryAction } = await loadActions();

    await createCategoryAction({ name: "Furniture", slug: "furniture" });
    const dupe = await createCategoryAction({ name: "Second Furniture", slug: "furniture" });
    assert.equal(dupe.success, false);
    assert.match(dupe.error!, /taken/i);

    const inUse = await deleteCategoryAction({ id: "99999999-0000-4000-8000-000000000001" });
    assert.equal(inUse.success, false);
    assert.match(inUse.error!, /still has 1 listing/i, "the refusal states the real blocker");
  });
});

describe("the admin action surface is exactly what it should be — and no more", () => {
  it("no action can touch orders, payments, or account roles", async () => {
    const mod = await loadActions();
    const exported = Object.keys(mod).sort();

    assert.deepEqual(exported, [
      "createCategoryAction",
      "deleteCategoryAction",
      "moderateListingAction",
      "rejectSellerAction",
      "resetSellerVerificationAction",
      "updateCategoryAction",
      "verifySellerAction",
    ]);
    for (const name of exported) {
      assert.doesNotMatch(
        name,
        /order|payment|refund|payout|role|password|ban/i,
        "financial and identity mutations must not appear as admin actions at all"
      );
    }
  });
});
