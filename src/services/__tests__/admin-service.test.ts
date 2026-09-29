import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  clearAdminStore,
  createFakeAdminStore,
  seedCategory,
  seedOrder,
  seedProduct,
  seedProfile,
  seedReport,
  seedSeller,
  seedUser,
  type FakeAdminStore,
} from "./fake-admin-store";

/**
 * The admin service, executed for real against an in-memory Prisma stand-in —
 * the same harness the listing/order suites use (`fake-marketplace-store`).
 * What is pinned down here:
 *
 *  - list queries filter exactly as the admin UI promises (and paginate);
 *  - seller verification + listing moderation only accept the state
 *    transitions the schema's enums define, and every accepted write emits
 *    BOTH an audit event and a seller notification;
 *  - moderation never hard-deletes: it moves `Product.status` and leaves the
 *    row (order history) intact;
 *  - order reads touch no writer — the module exposes no order mutation at all;
 *  - forged/unknown ids fail with the service's own clean error, never a
 *    blind write.
 */

const store: FakeAdminStore = createFakeAdminStore();

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });

const ADMIN = { id: "admin-actor", email: "admin@malihub.co.ke" };

let service: typeof import("@/services/admin-service");

before(async () => {
  service = await import("@/services/admin-service");
});

beforeEach(() => {
  clearAdminStore(store);
});

function marketplaceFixture() {
  const buyer = seedUser(store, { email: "buyer@example.com", role: "BUYER" });
  seedProfile(store, { userId: buyer.id, fullName: "Bryn Achieng" });

  const sellerUser = seedUser(store, { email: "sara@mama-nairobi.co.ke", role: "SELLER" });
  seedProfile(store, { userId: sellerUser.id, fullName: "Sara Wanjiru" });
  const seller = seedSeller(store, {
    userId: sellerUser.id,
    businessName: "Mama Nitende",
    verificationStatus: "PENDING",
  });

  const admin = seedUser(store, { email: "ops@malihub.co.ke", role: "ADMIN" });
  seedProfile(store, { userId: admin.id, fullName: "Ops Admin" });

  const category = seedCategory(store, { name: "Electronics", slug: "electronics" });
  const listing = seedProduct(store, {
    sellerId: seller.id,
    ownerId: sellerUser.id,
    categoryId: category.id,
    title: "Second-hand fridge",
    status: "PENDING_REVIEW",
    priceCents: 250_000,
  });

  const order = seedOrder(store, {
    buyerId: buyer.id,
    sellerId: seller.id,
    status: "PAID",
    totalCents: 250_000,
    subtotalCents: 250_000,
  });
  store.tables.orderItems.set("item-1", {
    id: "item-1",
    orderId: order.id,
    productId: listing.id,
    quantity: 1,
    unitPriceCents: 250_000,
    totalCents: 250_000,
    createdAt: new Date("2026-01-06T00:00:00Z"),
  });

  return { buyer, sellerUser, seller, admin, category, listing, order };
}

describe("admin list queries — filters and pagination are real", () => {
  it("users list filters by role and search term, and reports totals", async () => {
    const { buyer } = marketplaceFixture();

    const all = await service.listAdminUsers({ page: 1 }, store as never);
    assert.equal(all.total, 3);
    assert.equal(all.users.length, 3);

    const sellers = await service.listAdminUsers({ page: 1, role: "SELLER" }, store as never);
    assert.equal(sellers.total, 1);
    assert.equal(sellers.users[0]!.email, "sara@mama-nairobi.co.ke");
    assert.ok(sellers.users[0]!.seller, "seller relation is attached for the list view");
    assert.equal(sellers.users[0]!._count.products, 1);

    const byName = await service.listAdminUsers({ page: 1, q: "bryn" }, store as never);
    assert.equal(byName.total, 1);
    assert.equal(byName.users[0]!.id, buyer.id);

    const byEmail = await service.listAdminUsers({ page: 1, q: "OPS@MALIHUB" }, store as never);
    assert.equal(byEmail.total, 1, "search is case-insensitive on the email column");
    assert.equal(byEmail.users[0]!.email, "ops@malihub.co.ke");
  });

  it("users list filters deactivated and banned accounts separately", async () => {
    const banned = seedUser(store, { email: "ban@example.com", isBanned: true });
    const inactive = seedUser(store, { email: "gone@example.com", isActive: false });
    seedUser(store, { email: "live@example.com" });

    const bannedOnly = await service.listAdminUsers({ page: 1, account: "banned" }, store as never);
    assert.deepEqual(bannedOnly.users.map((u) => u.id), [banned.id]);

    const inactiveOnly = await service.listAdminUsers({ page: 1, account: "inactive" }, store as never);
    assert.deepEqual(inactiveOnly.users.map((u) => u.id), [inactive.id]);

    const activeOnly = await service.listAdminUsers({ page: 1, account: "active" }, store as never);
    assert.equal(activeOnly.total, 1);
    assert.equal(activeOnly.users[0]!.email, "live@example.com");
  });

  it("sellers list filters by verification status and business name", async () => {
    const { seller } = marketplaceFixture();
    const otherUser = seedUser(store, { email: "other@seller.ke", role: "SELLER" });
    seedSeller(store, {
      userId: otherUser.id,
      businessName: "Thika Tools",
      verificationStatus: "VERIFIED",
    });

    const pending = await service.listAdminSellers({ page: 1, verification: "PENDING" }, store as never);
    assert.deepEqual(pending.sellers.map((s) => s.id), [seller.id]);

    const byName = await service.listAdminSellers({ page: 1, q: "thika" }, store as never);
    assert.equal(byName.total, 1);
    assert.equal(byName.sellers[0]!.businessName, "Thika Tools");
    assert.equal(byName.sellers[0]!.user.email, "other@seller.ke");
  });

  it("listings list filters by status, category slug and seller", async () => {
    const { listing, seller } = marketplaceFixture();
    const otherCat = seedCategory(store, { name: "Furniture", slug: "furniture" });
    const second = seedProduct(store, {
      sellerId: seller.id,
      ownerId: listing.ownerId,
      categoryId: otherCat.id,
      title: "Sofa",
      status: "ACTIVE",
    });

    const pending = await service.listAdminListings({ page: 1, status: "PENDING_REVIEW" }, store as never);
    assert.deepEqual(pending.listings.map((l) => l.id), [listing.id]);

    const furniture = await service.listAdminListings({ page: 1, category: "furniture" }, store as never);
    assert.deepEqual(furniture.listings.map((l) => l.id), [second.id]);

    const bySeller = await service.listAdminListings({ page: 1, seller: "mama" }, store as never);
    assert.equal(bySeller.total, 2);

    const active = await service.listAdminListings({ page: 1, status: "ACTIVE" }, store as never);
    assert.deepEqual(active.listings.map((l) => l.id), [second.id]);
  });

  it("pagination: page 2 skips and totals stay honest", async () => {
    const user = seedUser(store, { email: "multi@example.com" });
    for (let i = 0; i < 30; i++) {
      seedUser(store, { email: `buyer${String(i).padStart(2, "0")}@example.com`, createdAt: new Date(2026, 0, 1 + i) });
    }

    const first = await service.listAdminUsers({ page: 1 }, store as never);
    const second = await service.listAdminUsers({ page: 2 }, store as never);

    assert.equal(first.total, 31);
    assert.equal(first.users.length, service.ADMIN_PAGE_SIZE);
    assert.equal(second.total, 31);
    assert.equal(second.users.length, 6);
    assert.ok(second.users.some((u) => u.id === user.id), "the oldest account lands on page 2 under newest-first ordering");
  });

  it("orders list filters by status and matches on order number or buyer", async () => {
    const { order, buyer } = marketplaceFixture();

    const paid = await service.listAdminOrders({ page: 1, status: "PAID" }, store as never);
    assert.deepEqual(paid.orders.map((o) => o.id), [order.id]);

    const byNumber = await service.listAdminOrders({ page: 1, q: order.orderNumber.slice(3, 7) }, store as never);
    assert.equal(byNumber.total, 1);

    const byEmail = await service.listAdminOrders({ page: 1, q: buyer.email }, store as never);
    assert.equal(byEmail.total, 1);
    assert.equal(byEmail.orders[0]!.buyer.profile?.fullName, "Bryn Achieng");
  });
});

describe("seller verification — only the transitions the enum supports", () => {
  it("moves a PENDING seller to VERIFIED, notifies the owner and audits it", async () => {
    const { seller, sellerUser } = marketplaceFixture();

    const result = await service.setSellerVerificationStatus({
      sellerId: seller.id,
      decision: "VERIFIED",
      note: "Documents match",
      actor: ADMIN,
      db: store as never,
    });

    assert.equal(result.verificationStatus, "VERIFIED");
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "VERIFIED");

    // The seller heard about it, through the existing notification pipeline.
    const notification = [...store.tables.notifications.values()][0]!;
    assert.equal(notification.userId, sellerUser.id);
    assert.equal(notification.type, "SYSTEM");
    assert.match(String(notification.body), /Documents match/);

    // …and the audit trail recorded who did it, from what, to what.
    const audit = [...store.tables.auditLogs.values()][0]!;
    assert.equal(audit.action, "moderation.seller_verified");
    assert.equal(audit.actorId, ADMIN.id);
    assert.equal(audit.actorEmail, ADMIN.email);
    assert.equal(audit.targetType, "seller");
    assert.equal(audit.targetId, seller.id);
    assert.deepEqual(audit.metadata, { from: "PENDING", to: "VERIFIED", note: "Documents match" });
  });

  it("rejects a PENDING seller and keeps the note out of the row itself", async () => {
    const { seller } = marketplaceFixture();

    await service.setSellerVerificationStatus({
      sellerId: seller.id,
      decision: "REJECTED",
      note: "ID photo unreadable",
      actor: ADMIN,
      db: store as never,
    });

    const row = store.tables.sellers.get(seller.id)!;
    assert.equal(row.verificationStatus, "REJECTED");
    assert.ok(!("reviewNote" in row), "the schema has no note column — nothing was written there");
  });

  it("refuses a no-op transition (already in the target status)", async () => {
    const { seller } = marketplaceFixture();
    await service.setSellerVerificationStatus({
      sellerId: seller.id,
      decision: "VERIFIED",
      actor: ADMIN,
      db: store as never,
    });

    await assert.rejects(
      () =>
        service.setSellerVerificationStatus({
          sellerId: seller.id,
          decision: "VERIFIED",
          actor: ADMIN,
          db: store as never,
        }),
      (error: unknown) =>
        error instanceof service.AdminServiceError && /already verified/i.test(error.message)
    );
    assert.equal(store.tables.auditLogs.size, 1, "the rejected attempt wrote nothing further");
  });

  it("refuses a transition the enum does not model (VERIFIED → PENDING)", async () => {
    const { seller } = marketplaceFixture();
    await service.setSellerVerificationStatus({
      sellerId: seller.id,
      decision: "VERIFIED",
      actor: ADMIN,
      db: store as never,
    });

    await assert.rejects(
      () =>
        service.setSellerVerificationStatus({
          sellerId: seller.id,
          // Not offered by the action layer, and not implemented here either:
          // the service only knows VERIFIED / REJECTED / UNVERIFIED.
          decision: "PENDING" as never,
          actor: ADMIN,
          db: store as never,
        }),
      (error: unknown) => error instanceof service.AdminServiceError
    );
    assert.equal(store.tables.sellers.get(seller.id)!.verificationStatus, "VERIFIED");
  });

  it("a forged or unknown seller id fails cleanly with no side effects", async () => {
    await assert.rejects(
      () =>
        service.setSellerVerificationStatus({
          sellerId: randomUUID(),
          decision: "VERIFIED",
          actor: ADMIN,
          db: store as never,
        }),
      (error: unknown) => error instanceof service.AdminServiceError && /not found/i.test(error.message)
    );
    assert.equal(store.tables.auditLogs.size, 0);
    assert.equal(store.tables.notifications.size, 0);

    await assert.rejects(
      () =>
        service.setSellerVerificationStatus({
          sellerId: "not-even-a-uuid",
          decision: "VERIFIED",
          actor: ADMIN,
          db: store as never,
        }),
      (error: unknown) => error instanceof service.AdminServiceError
    );
  });

  it("detail screen aggregates this seller's real catalogue and sales", async () => {
    const { seller, listing } = marketplaceFixture();
    seedProduct(store, {
      sellerId: seller.id,
      ownerId: listing.ownerId,
      categoryId: listing.categoryId,
      title: "Gas cooker",
      status: "ACTIVE",
    });

    const detail = await service.getAdminSellerDetail(seller.id, store as never);
    assert.ok(detail);
    assert.equal(detail.listings.total, 2);
    assert.equal(detail.listings.active, 1);
    assert.equal(detail.listings.pendingReview, 1);
    assert.equal(detail.sales.totalOrders, 1);
    assert.equal(detail.sales.paidOrders, 1);
    assert.equal(detail.sales.paidRevenueCents, 250_000);
    assert.equal(detail.recentListings.length, 2);
    assert.equal(detail.seller.user.profile?.fullName, "Sara Wanjiru");
  });
});

describe("listing moderation — soft states only, rows survive", () => {
  it("approve publishes a PENDING_REVIEW listing, stamps publishedAt, notifies + audits", async () => {
    const { listing, sellerUser } = marketplaceFixture();

    const result = await service.moderateListing({
      productId: listing.id,
      action: "approve",
      note: "Looks genuine",
      actor: ADMIN,
      db: store as never,
    });

    assert.equal(result.status, "ACTIVE");
    const row = store.tables.products.get(listing.id)!;
    assert.equal(row.status, "ACTIVE");
    assert.ok(row.publishedAt instanceof Date, "first publication stamps publishedAt");

    const notification = [...store.tables.notifications.values()][0]!;
    assert.equal(notification.userId, sellerUser.id);
    assert.equal(notification.type, "LISTING_APPROVED");

    const audit = [...store.tables.auditLogs.values()][0]!;
    assert.equal(audit.action, "moderation.listing_approved");
    assert.equal(audit.targetType, "listing");
    assert.deepEqual(audit.metadata, { from: "PENDING_REVIEW", to: "ACTIVE", note: "Looks genuine" });
  });

  it("reject marks REMOVED without deleting the row (order history intact)", async () => {
    const { listing, order } = marketplaceFixture();

    await service.moderateListing({
      productId: listing.id,
      action: "reject",
      actor: ADMIN,
      db: store as never,
    });

    assert.equal(store.tables.products.get(listing.id)!.status, "REMOVED");
    assert.ok(store.tables.products.has(listing.id), "the listing row survives a takedown");
    assert.ok(store.tables.orderItems.has("item-1"), "its order items are untouched");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID", "the order is NOT touched");

    const notification = [...store.tables.notifications.values()][0]!;
    assert.equal(notification.type, "LISTING_REJECTED");
  });

  it("suspend works from ACTIVE; restore returns it", async () => {
    const { listing } = marketplaceFixture();
    await service.moderateListing({ productId: listing.id, action: "approve", actor: ADMIN, db: store as never });

    const suspended = await service.moderateListing({
      productId: listing.id,
      action: "suspend",
      note: "Suspected counterfeit",
      actor: ADMIN,
      db: store as never,
    });
    assert.equal(suspended.status, "SUSPENDED");
    assert.equal(store.tables.auditLogs.size, 2);

    const restored = await service.moderateListing({
      productId: listing.id,
      action: "restore",
      actor: ADMIN,
      db: store as never,
    });
    assert.equal(restored.status, "ACTIVE");
    const lastAudit = [...store.tables.auditLogs.values()].at(-1)!;
    assert.equal(lastAudit.action, "moderation.listing_restored");
  });

  it("refuses transitions that would corrupt state (approve an ACTIVE listing)", async () => {
    const { listing } = marketplaceFixture();
    await service.moderateListing({ productId: listing.id, action: "approve", actor: ADMIN, db: store as never });

    await assert.rejects(
      () => service.moderateListing({ productId: listing.id, action: "approve", actor: ADMIN, db: store as never }),
      (error: unknown) =>
        error instanceof service.AdminServiceError && /active listing cannot be approved/i.test(error.message)
    );
    // …but a listing that was already rejected can be restored by policy.
    const second = await service.listAdminListings({ page: 1 }, store as never);
    assert.equal(second.listings[0]!.status, "ACTIVE");
  });

  it("reject is not offered for a SOLD listing (it would erase transaction context)", async () => {
    const { listing } = marketplaceFixture();
    store.tables.products.get(listing.id)!.status = "SOLD";

    await assert.rejects(
      () => service.moderateListing({ productId: listing.id, action: "reject", actor: ADMIN, db: store as never }),
      (error: unknown) => error instanceof service.AdminServiceError
    );
    assert.equal(store.tables.products.get(listing.id)!.status, "SOLD");
  });

  it("unknown listing id and non-UUID id both fail with no writes", async () => {
    await assert.rejects(
      () => service.moderateListing({ productId: randomUUID(), action: "approve", actor: ADMIN, db: store as never }),
      (error: unknown) => error instanceof service.AdminServiceError && /not found/i.test(error.message)
    );
    await assert.rejects(
      () => service.moderateListing({ productId: "1", action: "approve", actor: ADMIN, db: store as never }),
      (error: unknown) => error instanceof service.AdminServiceError
    );
    assert.equal(store.tables.auditLogs.size, 0);
  });

  it("detail screen surfaces open reports and the seller record", async () => {
    const { listing } = marketplaceFixture();
    seedReport(store, { productId: listing.id, reporterId: "someone", status: "OPEN" });
    seedReport(store, { productId: listing.id, reporterId: "someone2", status: "DISMISSED" });

    const detail = await service.getAdminListingDetail(listing.id, store as never);
    assert.ok(detail);
    assert.equal(detail.openReports, 1, "only OPEN/REVIEWING count as open");
    assert.equal(detail.product.seller.businessName, "Mama Nitende");
    assert.equal(detail.product.owner.profile?.fullName, "Sara Wanjiru");
    assert.equal(detail.product._count.reports, 2, "all reports are counted for context");
  });
});

describe("orders — the admin surface is read-only by construction", () => {
  it("the service exposes no order mutation function at all", () => {
    const exports = Object.keys(service);
    assert.ok(
      !exports.some((name) => /setOrder|updateOrder|cancelOrder|refundOrder|markPaid/i.test(name)),
      `no order-mutation export expected, got: ${exports.join(", ")}`
    );
  });

  it("detail reads items, buyer, seller and payments as recorded", async () => {
    const { order, listing } = marketplaceFixture();
    store.tables.payments.set("pay-1", {
      id: "pay-1",
      orderId: order.id,
      provider: "MANUAL",
      method: "CASH_ON_DELIVERY",
      status: "SUCCESS",
      amountCents: 250_000,
      currency: "KES",
      paidAt: new Date("2026-01-06T12:00:00Z"),
      createdAt: new Date("2026-01-06T11:00:00Z"),
    });

    const detail = await service.getAdminOrderDetail(order.id, store as never);
    assert.ok(detail);
    assert.equal(detail.orderNumber, order.orderNumber);
    assert.equal(detail.items.length, 1);
    assert.equal(detail.items[0]!.product.title, listing.title);
    assert.equal(detail.buyer.profile?.fullName, "Bryn Achieng");
    assert.equal(detail.seller.businessName, "Mama Nitende");
    assert.equal(detail.payments.length, 1);
    assert.equal(detail.payments[0]!.status, "SUCCESS");
    assert.ok(!("payerReference" in (detail.payments[0] as Record<string, unknown>)));
    assert.ok(!("rawCallbackPayload" in (detail.payments[0] as Record<string, unknown>)));
  });

  it("a non-UUID order id reads as not-found rather than erroring at the DB", async () => {
    assert.equal(await service.getAdminOrderDetail("12", store as never), null);
  });
});

describe("overview metrics are exactly what the data supports", () => {
  it("counts real rows and reports zero for an empty marketplace", async () => {
    const empty = await service.getAdminOverview(store as never);
    assert.equal(empty.users.total, 0);
    assert.equal(empty.listings.total, 0);
    assert.equal(empty.orders.total, 0);
    assert.equal(empty.orders.bookedValueCents, 0);
    assert.deepEqual(empty.recent.users, []);
    assert.deepEqual(empty.recent.auditEvents, []);

    const { listing } = marketplaceFixture();
    seedProduct(store, {
      sellerId: listing.sellerId,
      ownerId: listing.ownerId,
      categoryId: listing.categoryId,
      title: "Bike",
      status: "SUSPENDED",
    });

    const data = await service.getAdminOverview(store as never);
    assert.equal(data.users.total, 3);
    assert.equal(data.users.buyers, 1);
    assert.equal(data.users.sellers, 1);
    assert.equal(data.users.staff, 1);
    assert.equal(data.sellers.pendingVerifications, 1);
    assert.equal(data.sellers.verified, 0);
    assert.equal(data.listings.total, 2);
    assert.equal(data.listings.pendingReview, 1);
    assert.equal(data.listings.suspended, 1);
    assert.equal(data.orders.total, 1);
    assert.equal(data.orders.paid, 1);
    assert.equal(data.orders.paidValueCents, 250_000);
    assert.equal(data.orders.bookedValueCents, 250_000);
    assert.equal(data.recent.users.length, 3);
  });

  it("cancelled and refunded orders are excluded from booked value but counted", async () => {
    const { seller, buyer } = marketplaceFixture();
    seedOrder(store, { buyerId: buyer.id, sellerId: seller.id, status: "CANCELLED", totalCents: 99_000, subtotalCents: 99_000 });
    seedOrder(store, { buyerId: buyer.id, sellerId: seller.id, status: "REFUNDED", totalCents: 50_000, subtotalCents: 50_000 });

    const data = await service.getAdminOverview(store as never);
    assert.equal(data.orders.total, 3);
    assert.equal(data.orders.cancelled, 1);
    assert.equal(data.orders.bookedValueCents, 250_000);
    assert.equal(data.orders.paidValueCents, 250_000);
  });
});

describe("audit log reads", () => {
  it("lists newest-first and filters by action or actor email", async () => {
    const { listing } = marketplaceFixture();
    await service.moderateListing({ productId: listing.id, action: "approve", actor: ADMIN, db: store as never });

    const all = await service.listAdminAuditEvents({ page: 1 }, store as never);
    assert.equal(all.total, 1);
    assert.equal(all.events[0]!.action, "moderation.listing_approved");

    const byAction = await service.listAdminAuditEvents({ page: 1, q: "listing_approved" }, store as never);
    assert.equal(byAction.total, 1);

    const byActor = await service.listAdminAuditEvents({ page: 1, q: "admin@malihub" }, store as never);
    assert.equal(byActor.total, 1);

    const noMatch = await service.listAdminAuditEvents({ page: 1, q: "something-else" }, store as never);
    assert.equal(noMatch.total, 0);
  });
});

describe("categories — CRUD against the real shared table", () => {
  it("creates with a derived slug and audits it", async () => {
    const category = await service.createAdminCategory({
      name: "Fishing Nets",
      sortOrder: 5,
      actor: ADMIN,
      db: store as never,
    });

    assert.equal(category.slug, "fishing-nets");
    assert.equal(store.tables.categories.size, 1);
    const audit = [...store.tables.auditLogs.values()][0]!;
    assert.equal(audit.action, "admin.category_created");
    assert.equal(audit.targetType, "category");
  });

  it("a duplicate slug is reported as a conflict, not a crash", async () => {
    seedCategory(store, { name: "Electronics", slug: "electronics" });
    await assert.rejects(
      () => service.createAdminCategory({ name: "Other Electronics", slug: "electronics", sortOrder: 0, actor: ADMIN, db: store as never }),
      (error: unknown) => error instanceof service.AdminServiceError && /taken/i.test(error.message)
    );
  });

  it("deleting a category that still has listings is refused", async () => {
    const { category } = marketplaceFixture();

    await assert.rejects(
      () => service.deleteAdminCategory({ id: category.id, actor: ADMIN, db: store as never }),
      (error: unknown) =>
        error instanceof service.AdminServiceError && /still has 1 listing/i.test(error.message)
    );
    assert.ok(store.tables.categories.has(category.id), "the category survived the attempt");
  });

  it("an empty category can be deleted, and the deletion is audited", async () => {
    const category = seedCategory(store, { name: "Boats", slug: "boats" });

    await service.deleteAdminCategory({ id: category.id, actor: ADMIN, db: store as never });

    assert.equal(store.tables.categories.size, 0);
    const audit = [...store.tables.auditLogs.values()][0]!;
    assert.equal(audit.action, "admin.category_deleted");
  });

  it("update can deactivate (hiding it publicly) without removing it", async () => {
    const { category } = marketplaceFixture();

    const updated = await service.updateAdminCategory({
      id: category.id,
      name: category.name as string,
      sortOrder: 3,
      isActive: false,
      actor: ADMIN,
      db: store as never,
    });

    assert.equal(updated.isActive, false);
    assert.ok(store.tables.categories.has(category.id));
    const audit = [...store.tables.auditLogs.values()][0]!;
    assert.equal(audit.action, "admin.category_updated");
  });

  it("list attaches the live listing count per category", async () => {
    const { category } = marketplaceFixture();
    const rows = await service.listAdminCategories(store as never);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, category.id);
    assert.equal((rows[0]!._count as { products: number }).products, 1);
  });
});
