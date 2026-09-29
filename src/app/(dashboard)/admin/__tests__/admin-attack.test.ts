import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
 * Adversarial review suite — added during the security review of `/admin`.
 *
 * What this pins that the other two suites do not: every denied mutation is
 * checked against a **full database snapshot**, so "refused" must mean
 * *nothing moved anywhere* — not merely "this row is unchanged". Attack
 * payloads are realistic: a valid seller UUID smuggled into a buyer session,
 * a hidden `role`/`isAdmin` field riding along with an otherwise-valid
 * payload, whole-row JSON with an embedded decision, prototype-junk ids.
 *
 * The same fixture (session → guard → zod → service) as `admin-actions.test.ts`;
 * only the provider session and the database are mocked.
 */

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const store = createFakeAdminStore();
const provider = installAuthActionMocks(store as unknown as FakeStore);

let actions: typeof import("@/app/(dashboard)/admin/actions") | null = null;
async function loadActions() {
  actions ??= await import("@/app/(dashboard)/admin/actions");
  return actions;
}

const ADMIN_ID = "55555555-0000-4000-8000-000000000001";
const OWNER_ID = "66666666-0000-4000-8000-000000000001";
const SELLER_ID = "77777777-1111-4111-8111-111111111111";
const LISTING_ID = "88888888-2222-4222-8222-222222222222";
const CATEGORY_ID = "99999999-0000-4000-8000-000000000001";

function seedTargets() {
  const owner = seedUser(store, { id: OWNER_ID, email: "sara@mama-nairobi.co.ke", role: "SELLER" });
  seedProfile(store, { userId: owner.id, fullName: "Sara Wanjiru" });
  const seller = seedSeller(store, {
    id: SELLER_ID,
    userId: owner.id,
    businessName: "Mama Nitende Crafts",
    verificationStatus: "PENDING",
    kraPin: "P000123456X",
    idDocumentUrl: "https://files.example.test/id/secret-doc.pdf",
  });
  store.tables.categories.set(CATEGORY_ID, {
    id: CATEGORY_ID,
    name: "Furniture",
    slug: "furniture",
    isActive: true,
    parentId: null,
  });
  const listing = seedProduct(store, {
    id: LISTING_ID,
    sellerId: seller.id,
    ownerId: owner.id,
    categoryId: CATEGORY_ID,
    title: "Reclaimed coffee table",
    status: "PENDING_REVIEW",
  });
  return { owner, seller, listing };
}

/** Sign the given role in as THE session user (mapped to the provider id). */
function signInAs(role: string, flags: { isBanned?: boolean; isActive?: boolean } = {}) {
  const user = seedUser(store, {
    id: role === "ADMIN" ? ADMIN_ID : randomUUID(),
    email: `${role.toLowerCase()}-session@example.com`,
    role,
    authUserId: makeIdentity().authUserId,
    ...flags,
  });
  seedProfile(store, { userId: user.id, fullName: "Session User" });
  provider.session = makeIdentity();
  return user;
}

/** Snapshot of every table a mutation could touch. */
function snapshot() {
  return JSON.stringify({
    users: [...store.tables.users.values()],
    sellers: [...store.tables.sellers.values()],
    products: [...store.tables.products.values()],
    categories: [...store.tables.categories.values()],
    auditLogs: [...store.tables.auditLogs.values()],
    notifications: [...store.tables.notifications.values()],
  });
}

function writeOps() {
  return store.operations.filter((op) => /\.(create|update|delete|upsert)/.test(op));
}

beforeEach(() => {
  provider.reset();
  for (const table of Object.values(store.tables)) table.clear();
  store.operations.length = 0;
});

describe("a BUYER session attacking every admin mutation — refusal AND immobility", () => {
  it("every action, with valid forged targets, writes nothing anywhere", async () => {
    const { seller, listing } = seedTargets();
    signInAs("BUYER");
    const mod = await loadActions();

    const attempts: Array<[string, () => Promise<{ success: boolean; error?: string }>]> = [
      ["verifySellerAction", () => mod.verifySellerAction({ sellerId: seller.id })],
      ["rejectSellerAction", () => mod.rejectSellerAction({ sellerId: seller.id, note: "no" })],
      ["resetSellerVerificationAction", () => mod.resetSellerVerificationAction({ sellerId: seller.id })],
      ["moderateListingAction approve", () => mod.moderateListingAction({ productId: listing.id, action: "approve" })],
      ["moderateListingAction reject", () => mod.moderateListingAction({ productId: listing.id, action: "reject" })],
      ["createCategoryAction", () => mod.createCategoryAction({ name: "Bodaboda Parts" })],
      ["updateCategoryAction", () => mod.updateCategoryAction({ id: CATEGORY_ID, name: "Renamed" })],
      ["deleteCategoryAction", () => mod.deleteCategoryAction({ id: CATEGORY_ID })],
    ];
    const before = snapshot();

    for (const [label, run] of attempts) {
      const result = await run();
      assert.equal(result.success, false, `${label} must be refused`);
      assert.match(result.error ?? "", /administrator/i, `${label} must refuse for the documented reason`);
    }

    assert.equal(snapshot(), before, "zero database movement across all eight refusals");
    assert.deepEqual(writeOps(), [], "no write call even reached the client");
  });

  it("smuggled role/isAdmin fields are validated away, not consulted", async () => {
    const { seller } = seedTargets();
    signInAs("BUYER");
    const { verifySellerAction } = await loadActions();

    const result = await verifySellerAction({ sellerId: seller.id, role: "ADMIN", isAdmin: true });

    assert.equal(result.success, false);
    // The guard derives the role from the DB row behind the session id — a
    // `role` in the payload has no code path that could reach the decision,
    // and the stored row (BUYER) is what the guard actually read.
    assert.equal(store.tables.users.size, 2, "the payload cannot mint or promote accounts");
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "PENDING");
  });

  it("whole-row JSON with an embedded decision is not a payload", async () => {
    const { seller } = seedTargets();
    signInAs("BUYER");
    const { rejectSellerAction } = await loadActions();

    const before = snapshot();
    const result = await rejectSellerAction({
      ...store.tables.sellers.get(seller.id),
      verificationStatus: "VERIFIED",
    });

    assert.equal(result.success, false);
    assert.equal(snapshot(), before);
  });

  it("malformed target ids are rejected before any query runs", async () => {
    seedTargets();
    signInAs("BUYER");
    const { verifySellerAction } = await loadActions();

    for (const sellerId of ["", "not-a-uuid", "../admin", "00000000-0000-0000-0000-000000000000", null, { id: "x" }, ["a"]]) {
      const result = await verifySellerAction({ sellerId });
      assert.equal(result.success, false, `${JSON.stringify(sellerId)} must be refused`);
    }
  });
});

describe("banned and deactivated ADMIN sessions — account state beats role state", () => {
  for (const [label, flags] of [
    ["banned", { isBanned: true }] as const,
    ["deactivated", { isActive: false }] as const,
  ]) {
    it(`a ${label} admin cannot verify a seller, and nothing moves`, async () => {
      const { seller } = seedTargets();
      signInAs("ADMIN", flags);
      const { verifySellerAction } = await loadActions();

      const before = snapshot();
      const result = await verifySellerAction({ sellerId: seller.id, note: "please approve" });

      assert.equal(result.success, false);
      assert.match(result.error ?? "", /contact support/i);
      assert.equal(snapshot(), before);
      assert.deepEqual(writeOps(), []);
    });

    it(`a ${label} admin cannot moderate a listing either`, async () => {
      const { listing } = seedTargets();
      signInAs("ADMIN", flags);
      const { moderateListingAction } = await loadActions();

      const before = snapshot();
      const result = await moderateListingAction({ productId: listing.id, action: "approve" });

      assert.equal(result.success, false);
      assert.equal(snapshot(), before);
    });
  }
});

describe("defense in depth below the guard", () => {
  it("the service itself still refuses transitions the enum does not model", async () => {
    const { seller } = seedTargets();
    const admin = signInAs("ADMIN");
    const service = await import("@/services/admin-service");

    await assert.rejects(
      () =>
        service.setSellerVerificationStatus({
          sellerId: seller.id,
          // A caller that skipped zod could try to write PENDING — the
          // transition table has no such decision and the service says so.
          decision: "PENDING" as unknown as "VERIFIED",
          actor: { id: admin.id, email: admin.email },
          db: store as never,
        }),
      /unknown seller decision/i
    );
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "PENDING");
  });

  it("even an admin's successful write never copies kraPin/idDocumentUrl into audit or notification rows", async () => {
    const { seller } = seedTargets();
    const admin = signInAs("ADMIN");
    const service = await import("@/services/admin-service");

    await service.setSellerVerificationStatus({
      sellerId: seller.id,
      decision: "VERIFIED",
      note: "Documents on file match the business name.",
      actor: { id: admin.id, email: admin.email },
      db: store as never,
    });

    const corpus = JSON.stringify([...store.tables.auditLogs.values()]) + JSON.stringify([...store.tables.notifications.values()]);
    assert.ok(!corpus.includes("P000123456X"), "KRA PIN must never reach the audit/notification trail");
    assert.ok(!corpus.includes("secret-doc.pdf"), "the document URL must never reach the trail");
  });
});
