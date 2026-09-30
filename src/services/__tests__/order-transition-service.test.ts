import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { OrderStatus } from "@prisma/client";

mock.module("server-only", { namedExports: {} });

/**
 * `logAuditEvent` and `notifyUser` both import the global `prisma` singleton
 * rather than an injected handle, so the module boundary is substituted the way
 * `admin-service.test.ts` does. A proxy is used instead of a fixed reference
 * because the store is rebuilt in `beforeEach`: the proxy always forwards to
 * whichever store is current.
 */
let store: FakeMarketplaceStore;
const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => (store as unknown as Record<string, unknown>)[property],
});
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });

/**
 * The order transition service, executed for real against the in-memory
 * marketplace store.
 *
 * These tests exist to pin the invariants a payment phase will inherit, and
 * several of them are stated as invariants rather than as examples:
 *
 *   1. A successful cancellation means `CANCELLED` **and** inventory restored
 *      exactly once — never one without the other.
 *   2. A failed cancellation leaves the order and the inventory untouched.
 *   3. A terminal order cannot move again.
 *   4. Authorization comes from the server-resolved identity, never input.
 *   5. Concurrent cancellation cannot release the same units twice.
 *   6. Audit/notification failures cannot leave partial state behind, because
 *      they happen strictly after the transaction commits.
 */

let service: typeof import("@/services/order-transition-service");

import {
  createFakeMarketplaceStore,
  seedCartItem,
  seedCategory,
  seedProduct,
  seedProfile,
  seedSeller,
  seedUser,
  type FakeMarketplaceStore,
} from "./fake-marketplace-store";

let db: ReturnType<typeof asTransitionStore>;

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";
const SELLER_1 = "seller-1";
const SELLER_2 = "seller-2";
function asTransitionStore(s: FakeMarketplaceStore) {
  return s as never;
}

before(async () => {
  service = await import("@/services/order-transition-service");
});

beforeEach(() => {
  store = createFakeMarketplaceStore();
  db = asTransitionStore(store);
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedProfile(store, BUYER_B, "Grace Atieno");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
  seedUser(store, { id: BUYER_B, email: "buyer-b@example.com" });
});

/** A seller with one ACTIVE listing at `quantity` units. */
function seedListing(
  userId: string,
  { quantity = 5, priceCents = 100_000, status = "ACTIVE" } = {}
) {
  const seller = seedSeller(store, { userId, businessName: `${userId} shop` });
  seedUser(store, { id: userId, email: `${userId}@example.com`, role: "SELLER" });
  const category = seedCategory(store, `cat-${userId}`);
  const product = seedProduct(store, {
    sellerId: seller.id,
    ownerId: userId,
    categoryId: category.id,
    quantity,
    priceCents,
    status,
  });
  return { seller, product };
}

/** Check out `quantity` of `product` for `buyerId`; returns the PENDING order. */
async function placeOrder(
  buyerId: string,
  productId: string,
  quantity = 1
): Promise<{ id: string; orderNumber: string; sellerId: string; totalCents: number }> {
  seedCartItem(store, buyerId, productId, quantity);
  const result = await import("@/services/order-service").then((m) => m.checkoutCart(db as never, buyerId));
  return result.orders[0]!;
}

const orderRow = (id: string) => store.tables.orders.get(id)!;
const stockOf = (productId: string) => store.tables.products.get(productId)!.quantity;

// ─── Cancellation: the happy path and its invariant ──────────────────────────

describe("cancelOrder — cancelling your own unpaid order", () => {
  it("cancels a PENDING order and restores exactly the reserved units", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    assert.equal(stockOf(product.id), 3, "checkout reserved 2 of 5");

    const result = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    assert.equal(result.changed, true);
    assert.equal(result.previousStatus, "PENDING");
    assert.equal(result.order.status, "CANCELLED");
    assert.equal(result.restoredUnits, 2);

    // INVARIANT 1: both halves held.
    assert.equal(orderRow(order.id).status, "CANCELLED");
    assert.equal(stockOf(product.id), 5);
  });

  it("returns the listing to the stock it had before checkout", async () => {
    // The precise statement of INVARIANT 1 with a non-zero end state, so a
    // release that silently double-counts cannot pass as "looks right".
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
    assert.equal(stockOf(product.id), 5);
  });

  it("restores every line item when the order has more than one", async () => {
    const first = seedListing(SELLER_1, { quantity: 4 });
    const second = seedProduct(store, {
      sellerId: first.seller.id,
      ownerId: SELLER_1,
      categoryId: seedCategory(store, "cat-2").id,
      quantity: 3,
      priceCents: 50_000,
      status: "ACTIVE",
    });
    seedCartItem(store, BUYER_A, first.product.id, 2);
    seedCartItem(store, BUYER_A, second.id, 3);
    const { checkoutCart } = await import("@/services/order-service");
    const checkout = await checkoutCart(db as never, BUYER_A);
    const order = checkout.orders[0]!;

    assert.equal(stockOf(first.product.id), 2);
    assert.equal(stockOf(second.id), 0);

    const result = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    assert.equal(result.restoredUnits, 5, "2 + 3 units");
    assert.equal(stockOf(first.product.id), 4);
    assert.equal(stockOf(second.id), 3);
  });

  it("restores the database's OrderItem quantity, not anything the caller says", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 9 });
    const order = await placeOrder(BUYER_A, product.id, 4);

    // A caller trying to inflate the release. `quantity` is not a parameter of
    // the function, so this is also a type-level guarantee.
    const result = await service.cancelOrder(db, {
      actorUserId: BUYER_A,
      orderId: order.id,
      reason: "changed my mind",
    });

    assert.equal(result.restoredUnits, 4, "the order line said 4, not 9 and not 1");
    assert.equal(stockOf(product.id), 9);
  });

  it("is idempotent in the sense that matters: no second release", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
    assert.equal(stockOf(product.id), 5);

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id }),
      (error: unknown) => error instanceof service.OrderTransitionError && error.code === "already_cancelled"
    );

    // INVARIANT 5 at the sequential level.
    assert.equal(stockOf(product.id), 5, "stock must not be released twice");
  });
});

// ─── Cancellation: authorization (INVARIANT 4) ──────────────────────────────

describe("cancelOrder — authorization is server-side", () => {
  it("refuses another buyer's order and answers as if it did not exist", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: BUYER_B, orderId: order.id }),
      (error: unknown) => error instanceof service.OrderTransitionError && error.code === "not_found"
    );

    // INVARIANT 2: nothing moved.
    assert.equal(orderRow(order.id).status, "PENDING");
    assert.equal(stockOf(product.id), 4);
  });

  it("gives the same not_found for a nonexistent id, so ids cannot be probed", async () => {
    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: BUYER_A, orderId: "00000000-0000-4000-8000-000000000000" }),
      (error: unknown) => error instanceof service.OrderTransitionError && error.code === "not_found"
    );
  });

  it("does not let the seller cancel their own buyer's order", async () => {
    const { seller, product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: SELLER_1, orderId: order.id }),
      (error: unknown) => error instanceof service.OrderTransitionError && error.code === "not_found"
    );
    assert.equal(orderRow(order.id).status, "PENDING");
    assert.ok(seller.id);
  });

  it("does not let one seller cancel another seller's order", async () => {
    const first = seedListing(SELLER_1, { quantity: 5 });
    seedListing(SELLER_2, { quantity: 5 });
    const order = await placeOrder(BUYER_A, first.product.id, 1);

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: SELLER_2, orderId: order.id }),
      (error: unknown) => error instanceof service.OrderTransitionError && error.code === "not_found"
    );
    assert.equal(orderRow(order.id).status, "PENDING");
  });

  it("refuses an order that has already been paid", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    await service.markOrderPaid(db, {
      orderId: order.id,
      actor: { id: "system", source: "test" },
    });
    assert.equal(orderRow(order.id).status, "PAID");

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError &&
        error.code === "invalid_transition" &&
        error.currentStatus === "PAID"
    );

    // INVARIANT 2 and 3: a paid order is neither cancelled nor restocked.
    assert.equal(orderRow(order.id).status, "PAID");
    assert.equal(stockOf(product.id), 4);
  });
});

// ─── Cancellation: concurrency (INVARIANT 5) ────────────────────────────────

describe("cancelOrder — concurrent requests release stock exactly once", () => {
  it("gives the release to exactly one of two simultaneous cancels", async () => {
    // The scenario from the brief, verbatim: stock 5, order of 2, two cancels
    // arriving together. Expected stock 7 from a naive read-then-write
    // implementation, because the loser would restore a second time.
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    assert.equal(stockOf(product.id), 3);

    // The hard interleaving: WE read PENDING and pass the pure check, and only
    // then does the rival transaction commit. `afterOrderRead` fires between
    // exactly those two beats, and `commitOrderStatus` is not undone by our
    // rollback because it belongs to a transaction that already committed.
    store.afterOrderRead = () => {
      store.commitOrderStatus(order.id, "CANCELLED");
    };

    let thrown: unknown = null;
    try {
      await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
    } catch (error) {
      thrown = error;
    }

    // Our conditional update found a row that was no longer PENDING → count 0.
    assert.ok(thrown instanceof service.OrderTransitionError, "the loser must be refused");
    assert.equal(thrown.code, "already_cancelled");
    assert.equal(orderRow(order.id).status, "CANCELLED", "the rival's commit survives");
    // The loser aborted at the claim, before the inventory step.
    assert.equal(stockOf(product.id), 3, "the loser must not restore anything");
  });

  it("one winner releases the units and the loser leaves the total alone", async () => {
    // Same race, stated as an end-to-end inventory invariant: after both
    // requests have run — one succeeding, one refused — stock must be back to
    // 5 exactly once, not 7.
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    // The winner runs first, to completion.
    const winner = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
    assert.equal(winner.restoredUnits, 2);
    assert.equal(stockOf(product.id), 5);

    // The loser's read now observes CANCELLED and its claim cannot match.
    store.afterOrderRead = () => {
      store.commitOrderStatus(order.id, "CANCELLED");
    };
    const second = await service
      .cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id })
      .then(() => "resolved", () => "refused");

    assert.equal(second, "refused");
    assert.equal(stockOf(product.id), 5, "exactly one release, not two");
  });

  it("leaves stock correct when two cancels are run back to back", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    const first = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
    assert.equal(first.restoredUnits, 2);
    assert.equal(stockOf(product.id), 5);

    const second = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id }).then(
      () => "resolved",
      () => "rejected"
    );
    assert.equal(second, "rejected");
    assert.equal(stockOf(product.id), 5);
  });

  it("cancellation and a payment confirmation produce exactly one winner", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    // Cancel wins the row; the payment attempt is then refused because the
    // order is no longer PENDING.
    const cancel = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
    assert.equal(cancel.order.status, "CANCELLED");

    await assert.rejects(
      () => service.markOrderPaid(db, { orderId: order.id, actor: { id: "system", source: "test" } }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "invalid_transition"
    );

    // The loser did no side effects: no restore, and no flip to PAID.
    assert.equal(stockOf(product.id), 5, "exactly one release total");
    assert.equal(orderRow(order.id).status, "CANCELLED");
  });

  it("a stale transition cannot overwrite a newer state", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    // This request read PENDING; a rival transaction paid the order before our
    // conditional update ran. A read-then-write implementation would now
    // overwrite PAID with CANCELLED — and release inventory for a paid order.
    store.afterOrderRead = () => {
      store.commitOrderStatus(order.id, "PAID");
    };

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError &&
        error.code === "invalid_transition" &&
        error.currentStatus === "PAID"
    );

    assert.equal(orderRow(order.id).status, "PAID", "the newer state survived");
    assert.equal(stockOf(product.id), 4, "no inventory moved for a refused transition");
  });

  it("a stale payment confirmation cannot overwrite a cancellation", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    store.afterOrderRead = () => {
      store.commitOrderStatus(order.id, "CANCELLED");
    };

    await assert.rejects(
      () => service.markOrderPaid(db, { orderId: order.id, actor: { id: "sys", source: "test" } }),
      (error: unknown) => error instanceof service.OrderTransitionError
    );

    assert.equal(orderRow(order.id).status, "CANCELLED");
    assert.equal(stockOf(product.id), 3, "a late callback must not change inventory");
  });

  it("a stale payment cannot overwrite a rival's committed state, and emits no side effects", async () => {
    // The full Phase 9.2 race, stated end to end. A payment confirmation is
    // the one transition whose loser must be guaranteed silent, because the
    // caller is a webhook that will retry whatever we tell it.
    //
    // The interleaving is real, not simulated by rollback: `afterOrderRead`
    // fires between this call's `findFirst` and its conditional claim, and
    // the rival's write goes through `commitOrderStatus`, which `restore()`
    // deliberately re-applies after our rollback because it models a
    // transaction that had already committed. If the rival's write were
    // merely erased, this test would pass without proving anything.
    const { product } = seedListing(SELLER_1, { quantity: 5, priceCents: 100_000 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    assert.equal(orderRow(order.id).status, "PENDING", "starts PENDING");

    // Place checkout writes no audit row and no notification, so both tables
    // start empty — which is what lets us assert "nothing was emitted" below.
    assert.equal(store.tables.auditLogs.size, 0);
    assert.equal(store.tables.notifications.size, 0);
    assert.equal(stockOf(product.id), 3, "units are reserved at checkout");

    store.afterOrderRead = () => {
      store.commitOrderStatus(order.id, "CANCELLED");
    };

    await assert.rejects(
      () =>
        service.markOrderPaid(db, {
          orderId: order.id,
          // The amount matches, so the rejection below can only be the race —
          // not the money check short-circuiting first.
          confirmedTotalCents: order.totalCents,
          actor: { id: "payment-webhook", source: "payment_webhook" },
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "invalid_transition"
    );

    assert.equal(
      orderRow(order.id).status,
      "CANCELLED",
      "the rival's commit must survive our rollback — this is what proves the race was real"
    );
    assert.equal(stockOf(product.id), 3, "inventory must be untouched by a refused payment");
    assert.equal(store.tables.auditLogs.size, 0, "a refused payment must write no audit row");
    assert.equal(store.tables.notifications.size, 0, "a refused payment must notify nobody");
  });
});

// ─── Cancellation: inventory semantics ──────────────────────────────────────

describe("cancelOrder — inventory restoration", () => {
  it("restores stock for a listing that was suspended while the order was open", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    // Moderated mid-order. The units were reserved while the listing was
    // ACTIVE, so they come back regardless — losing them would turn a
    // moderation decision into silent inventory loss.
    store.tables.products.get(product.id)!.status = "SUSPENDED";

    const result = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    assert.equal(result.restoredUnits, 2);
    assert.equal(stockOf(product.id), 5);
    assert.equal(store.tables.products.get(product.id)!.status, "SUSPENDED", "status untouched");
  });

  it("restores stock for a listing that was removed from sale", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    store.tables.products.get(product.id)!.status = "REMOVED";

    const result = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    assert.equal(result.restoredUnits, 2);
    assert.equal(stockOf(product.id), 5);
    assert.equal(store.tables.products.get(product.id)!.status, "REMOVED");
  });

  it("leaves the rest of a listing's fields alone", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5, priceCents: 250_000 });
    const order = await placeOrder(BUYER_A, product.id, 2);
    const before = { ...store.tables.products.get(product.id)! };
    assert.equal(before.quantity, 3, "2 were reserved at checkout");

    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    const after = store.tables.products.get(product.id)!;
    // The quantity is the one field that must change.
    assert.equal(after.quantity, 5);
    // Everything else is the seller's listing, not ours to touch.
    assert.equal(after.priceCents, before.priceCents);
    assert.equal(after.status, before.status);
    assert.equal(after.title, before.title);
    assert.equal(after.slug, before.slug);
    assert.equal(after.sellerId, before.sellerId);
    assert.equal(after.priceCents, 250_000, "the listed price is not marked as sold");
  });

  it("rolls the cancellation back when a listing cannot be restocked", async () => {
    // A missing product is a corrupted order (OrderItem.product is
    // onDelete: Restrict, so it should be impossible). The important part is
    // what happens to the OTHER half of the invariant when it does happen.
    const first = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, first.product.id, 2);

    const originalUpdateMany = store.product.updateMany.bind(store.product);
    store.product.updateMany = async () => ({ count: 0 }); // product vanished

    await assert.rejects(
      () => service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id }),
      (error: unknown) => error instanceof service.OrderTransitionError
    );
    store.product.updateMany = originalUpdateMany;

    // INVARIANT 2: the status change rolled back with the failed release, so
    // we can never be left with CANCELLED + unrestocked inventory.
    assert.equal(orderRow(order.id).status, "PENDING");
    assert.equal(stockOf(first.product.id), 3, "no partial release");
  });
});

// ─── PENDING → PAID: the Phase 9.2 seam ──────────────────────────────────────

describe("markOrderPaid — the PENDING → PAID primitive", () => {
  it("moves a PENDING order to PAID", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    const result = await service.markOrderPaid(db, {
      orderId: order.id,
      actor: { id: "payment-webhook", source: "payment_webhook" },
    });

    assert.equal(result.changed, true);
    assert.equal(result.previousStatus, "PENDING");
    assert.equal(result.order.status, "PAID");
    assert.equal(orderRow(order.id).status, "PAID");
  });

  it("creates no Payment row — payment is a separate financial event", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    await service.markOrderPaid(db, {
      orderId: order.id,
      actor: { id: "payment-webhook", source: "payment_webhook" },
    });

    // Phase 9.1 must not fabricate financial records. The fake store models a
    // payments table since Phase 9.2-A; `markOrderPaid` must leave it empty.
    assert.equal(store.tables.payments.size, 0, "no Payment row was created");
  });

  it("does not restore inventory — paying is not cancelling", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    const result = await service.markOrderPaid(db, {
      orderId: order.id,
      actor: { id: "payment-webhook", source: "payment_webhook" },
    });

    assert.equal(result.restoredUnits, 0);
    assert.equal(stockOf(product.id), 3, "the sold units stay sold");
  });

  it("refuses a confirmed amount that does not match the order total", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5, priceCents: 100_000 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    await assert.rejects(
      () =>
        service.markOrderPaid(db, {
          orderId: order.id,
          confirmedTotalCents: 100, // KES 1 for a KES 2,000 order
          actor: { id: "payment-webhook", source: "payment_webhook" },
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "amount_mismatch"
    );

    assert.equal(orderRow(order.id).status, "PENDING");
  });

  it("accepts a confirmed amount equal to the order total", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5, priceCents: 100_000 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    const result = await service.markOrderPaid(db, {
      orderId: order.id,
      confirmedTotalCents: 200_000,
      orderNumber: order.orderNumber,
      actor: { id: "payment-webhook", source: "payment_webhook" },
    });

    assert.equal(result.order.status, "PAID");
  });

  it("refuses a callback whose order number belongs to a different order", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    await assert.rejects(
      () =>
        service.markOrderPaid(db, {
          orderId: order.id,
          orderNumber: "MH-SOMEONEELSE",
          actor: { id: "payment-webhook", source: "payment_webhook" },
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "amount_mismatch"
    );
  });

  it("is idempotent on a retried callback", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);
    const confirmation = {
      orderId: order.id,
      confirmedTotalCents: 100_000,
      actor: { id: "payment-webhook", source: "payment_webhook" },
    };

    const first = await service.markOrderPaid(db, confirmation);
    const second = await service.markOrderPaid(db, confirmation);

    assert.equal(first.changed, true);
    assert.equal(second.changed, false, "a retry writes nothing");
    assert.equal(second.order.status, "PAID");
    assert.equal(orderRow(order.id).status, "PAID");
  });

  it("a matching amount transitions the order and emits the expected side effects", async () => {
    // The success half of the amount contract. The rejection half is covered
    // above; what was previously untested is that the *accept* path still
    // writes the audit row and the notifications, so a silent no-op could not
    // pass as "amount verified".
    const { seller } = seedListing(SELLER_1, { quantity: 5, priceCents: 100_000 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 2);
    assert.equal(order.totalCents, 200_000, "two units at KES 1,000");

    const result = await service.markOrderPaid(db, {
      orderId: order.id,
      confirmedTotalCents: order.totalCents,
      actor: { id: "payment-webhook", source: "payment_webhook" },
    });

    assert.equal(result.order.status, "PAID");
    assert.equal(result.changed, true);
    assert.equal(orderRow(order.id).status, "PAID");

    const audit = [...store.tables.auditLogs.values()];
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, "order.paid");
    const recipients = new Set([...store.tables.notifications.values()].map((n) => n.userId));
    assert.ok(recipients.has(BUYER_A), "the buyer is notified");
    assert.ok(recipients.has(SELLER_1), "the seller is notified");
  });

  it("a mismatched amount leaves the order PENDING and emits nothing", async () => {
    // The rejection half, with the side-effect dimension asserted — the
    // existing test checks the status only, so a future refactor could have
    // emitted an audit row for a payment it then refused.
    const { seller } = seedListing(SELLER_1, { quantity: 5, priceCents: 100_000 });
    const productId = sellerProductId(store, seller.id);
    const order = await placeOrder(BUYER_A, productId, 2);
    const stockBefore = stockOf(productId);

    await assert.rejects(
      () =>
        service.markOrderPaid(db, {
          orderId: order.id,
          confirmedTotalCents: order.totalCents + 1, // off by a single cent
          actor: { id: "payment-webhook", source: "payment_webhook" },
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "amount_mismatch"
    );

    assert.equal(orderRow(order.id).status, "PENDING", "a refused amount leaves the order alone");
    assert.equal(stockOf(productId), stockBefore, "no inventory moved");
    assert.equal(store.tables.auditLogs.size, 0, "no audit row for a refused amount");
    assert.equal(store.tables.notifications.size, 0, "no notification for a refused amount");
  });

  it("permits an omitted confirmedTotalCents — documented internal-seam behaviour", async () => {
    // CASE C. This test **documents existing behaviour; it does not change
    // it.** `confirmedTotalCents` is optional on `PaymentConfirmation`, and
    // when it is absent the money check is skipped entirely and the order is
    // marked paid.
    //
    // The field is optional because this is an internal seam: a caller that
    // has already verified the amount against its own `Payment` row (the
    // Phase 9.2 path, where `Payment.amountCents` is the record of truth and
    // the callback is signature-verified) has no reason to re-supply it. The
    // contract is that *someone upstream* has checked the money.
    //
    // ⚠ PHASE 9.2: this is the sharpest edge on the service. There is no
    // runtime guard forcing a provider callback to pass the amount — omitting
    // it disables verification rather than failing closed. A webhook handler
    // that forgets the field would mark orders paid with no amount check at
    // all. Prefer making the field required, or deriving it from the
    // persisted `Payment` row, before any provider is wired up. This test
    // will then need updating deliberately.
    const { seller } = seedListing(SELLER_1, { quantity: 5, priceCents: 100_000 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);

    const result = await service.markOrderPaid(db, {
      orderId: order.id,
      // confirmedTotalCents deliberately omitted
      actor: { id: "payment-webhook", source: "payment_webhook" },
    });

    assert.equal(result.order.status, "PAID", "current behaviour: omission skips the check");
    assert.equal(result.changed, true);
    assert.equal(orderRow(order.id).status, "PAID");
  });

  it("cannot be pushed backwards out of a terminal state", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);
    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    await assert.rejects(
      () => service.markOrderPaid(db, { orderId: order.id, actor: { id: "sys", source: "test" } }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError &&
        error.code === "invalid_transition" &&
        error.currentStatus === "CANCELLED"
    );
  });
});

// ─── Fulfillment primitives ─────────────────────────────────────────────────

describe("markOrderFulfilled — PAID → SHIPPED → DELIVERED → COMPLETED", () => {
  it("walks an order to COMPLETED with the right actor at each step", async () => {
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);
    await service.markOrderPaid(db, { orderId: order.id, actor: { id: "sys", source: "test" } });

    const shipped = await service.markOrderFulfilled(db, "SHIPPED", {
      orderId: order.id,
      actorUserId: SELLER_1,
      actorSellerId: seller.id,
    });
    assert.equal(shipped.order.status, "SHIPPED");
    assert.equal(shipped.previousStatus, "PAID");

    const delivered = await service.markOrderFulfilled(db, "DELIVERED", {
      orderId: order.id,
      actorUserId: SELLER_1,
      actorSellerId: seller.id,
    });
    assert.equal(delivered.order.status, "DELIVERED");

    // Completion is the buyer's to confirm.
    const completed = await service.markOrderFulfilled(db, "COMPLETED", {
      orderId: order.id,
      actorUserId: BUYER_A,
    });
    assert.equal(completed.order.status, "COMPLETED");
  });

  it("refuses to ship an order that has not been paid", async () => {
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);

    await assert.rejects(
      () =>
        service.markOrderFulfilled(db, "SHIPPED", {
          orderId: order.id,
          actorUserId: SELLER_1,
          actorSellerId: seller.id,
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "invalid_transition"
    );
    assert.equal(orderRow(order.id).status, "PENDING");
  });

  it("will not let a different seller ship someone else's order", async () => {
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const other = seedListing(SELLER_2, { quantity: 5 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);
    await service.markOrderPaid(db, { orderId: order.id, actor: { id: "sys", source: "test" } });

    await assert.rejects(
      () =>
        service.markOrderFulfilled(db, "SHIPPED", {
          orderId: order.id,
          actorUserId: SELLER_2,
          actorSellerId: other.seller.id,
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "not_found"
    );
    assert.equal(orderRow(order.id).status, "PAID");
  });

  it("will not let the seller confirm completion in the buyer's place", async () => {
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);
    await service.markOrderPaid(db, { orderId: order.id, actor: { id: "sys", source: "test" } });
    await service.markOrderFulfilled(db, "SHIPPED", {
      orderId: order.id,
      actorUserId: SELLER_1,
      actorSellerId: seller.id,
    });
    await service.markOrderFulfilled(db, "DELIVERED", {
      orderId: order.id,
      actorUserId: SELLER_1,
      actorSellerId: seller.id,
    });

    await assert.rejects(
      () =>
        service.markOrderFulfilled(db, "COMPLETED", {
          orderId: order.id,
          actorUserId: SELLER_1,
          actorSellerId: seller.id,
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "not_found"
    );
    assert.equal(orderRow(order.id).status, "DELIVERED");
  });

  it("a stale fulfilment cannot overwrite a rival's committed state, and emits no side effects", async () => {
    // The mirror of the payment race, for the third entry point. Without this,
    // `markOrderFulfilled`'s conditional claim was the only status-guarded
    // write in the service that had no interleaving test behind it.
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const productId = sellerProductId(store, seller.id);
    const order = await placeOrder(BUYER_A, productId, 2);
    await service.markOrderPaid(db, { orderId: order.id, actor: { id: "sys", source: "test" } });
    assert.equal(orderRow(order.id).status, "PAID", "starts PAID, so SHIPPED is a legal move");

    // The setup above legitimately emitted one `order.paid` audit row and its
    // notifications. Deltas from here are what must not change.
    const auditsBefore = store.tables.auditLogs.size;
    const notificationsBefore = store.tables.notifications.size;
    assert.ok(auditsBefore > 0, "the payment audit is the baseline we measure against");

    store.afterOrderRead = () => {
      store.commitOrderStatus(order.id, "CANCELLED");
    };

    await assert.rejects(
      () =>
        service.markOrderFulfilled(db, "SHIPPED", {
          orderId: order.id,
          actorUserId: SELLER_1,
          actorSellerId: seller.id,
        }),
      (error: unknown) =>
        error instanceof service.OrderTransitionError && error.code === "invalid_transition"
    );

    assert.equal(
      orderRow(order.id).status,
      "CANCELLED",
      "the rival's commit must survive our rollback"
    );
    assert.equal(stockOf(productId), 3, "fulfilment never moves inventory, refused or not");
    assert.equal(
      store.tables.auditLogs.size,
      auditsBefore,
      "a refused fulfilment must not add an audit row"
    );
    assert.equal(
      store.tables.notifications.size,
      notificationsBefore,
      "a refused fulfilment must not notify anyone"
    );
    assert.ok(
      ![...store.tables.auditLogs.values()].some((a) => a.action === "order.shipped"),
      "no order.shipped audit row may exist for a refused transition"
    );
  });

  it("cannot ship an order that was cancelled", async () => {
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);
    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    await assert.rejects(
      () =>
        service.markOrderFulfilled(db, "SHIPPED", {
          orderId: order.id,
          actorUserId: SELLER_1,
          actorSellerId: seller.id,
        }),
      (error: unknown) => error instanceof service.OrderTransitionError
    );
    assert.equal(orderRow(order.id).status, "CANCELLED");
  });
});

/** The single listing belonging to `sellerId`. */
function sellerProductId(s: FakeMarketplaceStore, sellerId: string): string {
  const product = [...s.tables.products.values()].find((p) => p.sellerId === sellerId);
  assert.ok(product, "expected a seeded listing for this seller");
  return product.id;
}

// ─── Audit and notifications (INVARIANT 6) ───────────────────────────────────

describe("audit and notification", () => {
  it("records a cancellation with the actor and the transition", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    const audit = [...store.tables.auditLogs.values()];
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, "order.cancelled");
    assert.equal(audit[0]!.actorId, BUYER_A);
    assert.equal(audit[0]!.targetType, "order");
    assert.equal(audit[0]!.targetId, order.id);
    const metadata = audit[0]!.metadata as Record<string, unknown>;
    assert.equal(metadata.from, "PENDING");
    assert.equal(metadata.to, "CANCELLED");
    assert.equal(metadata.restoredUnits, 2);
  });

  it("writes no credentials, contacts or payment data into the audit trail", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    await service.cancelOrder(db, {
      actorUserId: BUYER_A,
      orderId: order.id,
      reason: "found it cheaper elsewhere",
    });

    const audit = [...store.tables.auditLogs.values()][0]!;
    const serialised = JSON.stringify(audit).toLowerCase();
    for (const forbidden of [
      "password",
      "token",
      "secret",
      "pin",
      "credential",
      "apikey",
      "api_key",
      "msisdn",
      "phone",
      "mpesa",
    ]) {
      assert.ok(!serialised.includes(forbidden), `audit trail must not contain "${forbidden}"`);
    }
  });

  it("notifies the buyer and the seller of a cancellation", async () => {
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, sellerProductId(store, seller.id), 1);

    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    const recipients = new Set([...store.tables.notifications.values()].map((n) => n.userId));
    assert.ok(recipients.has(BUYER_A));
    assert.ok(recipients.has(SELLER_1));
  });

  it("does not audit a transition that was refused", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    await assert.rejects(() =>
      service.cancelOrder(db, { actorUserId: BUYER_B, orderId: order.id })
    );

    assert.equal(store.tables.auditLogs.size, 0);
    assert.equal(store.tables.notifications.size, 0);
  });

  it("a notification failure does not undo a committed cancellation", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    const original = store.notification.create.bind(store.notification);
    store.notification.create = async () => {
      throw new Error("notification provider is down");
    };

    try {
      // Must resolve, not reject: the transaction already committed and the
      // caller is entitled to that answer.
      const result = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
      assert.equal(result.order.status, "CANCELLED");
    } finally {
      store.notification.create = original;
    }

    assert.equal(orderRow(order.id).status, "CANCELLED");
    assert.equal(stockOf(product.id), 5, "inventory release stands regardless");
  });

  it("an audit failure does not undo a committed cancellation", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 2);

    const original = store.auditLog.create.bind(store.auditLog);
    store.auditLog.create = async () => {
      throw new Error("audit sink unavailable");
    };

    try {
      const result = await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });
      assert.equal(result.order.status, "CANCELLED");
    } finally {
      store.auditLog.create = original;
    }

    assert.equal(stockOf(product.id), 5);
  });
});

// ─── Single authoritative writer ────────────────────────────────────────────

describe("the service is the only status writer", () => {
  it("routes every accepted change through a conditional, status-guarded update", async () => {
    const { product } = seedListing(SELLER_1, { quantity: 5 });
    const order = await placeOrder(BUYER_A, product.id, 1);

    store.operations.length = 0;
    await service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id });

    assert.ok(
      store.operations.includes("order.updateMany"),
      "the claim must be a conditional update"
    );
    assert.ok(
      !store.operations.includes("order.update"),
      "an unconditional update would be a blind write"
    );
  });

  it("never writes a status the state machine forbids", async () => {
    // This is the test that must fail if any entry point ever starts writing a
    // status the machine does not allow from the state it actually observed.
    //
    // It drives the service for real, from **every** enum status, through every
    // entry point that can write a status, and asserts the outcome against
    // `canTransitionOrder`:
    //
    //   - a forbidden move must throw and leave the row exactly as it was;
    //   - a repeated request (`from === to`) must resolve with `changed: false`
    //     rather than writing, which is the idempotent-replay contract;
    //   - a legal move is not exercised here — it would consume the status and
    //     make every later iteration start from a different place. The state
    //     machine's own suite already pins the legal set exhaustively, and the
    //     happy paths are covered by the per-transition describes above.
    //
    // The row is forced into each starting state with `commitOrderStatus`
    // rather than by driving the service there, so the loop never depends on
    // a path that this test is trying to verify.
    const { canTransitionOrder } = await import("@/lib/order-state-machine");
    const { seller } = seedListing(SELLER_1, { quantity: 5 });
    const productId = sellerProductId(store, seller.id);
    const order = await placeOrder(BUYER_A, productId, 1);

    /** Every call path in the service that can write an `Order.status`. */
    const writers: Array<{
      to: OrderStatus;
      /**
       * The code a *repeated* request is expected to produce, or `null` when
       * the entry point treats a repeat as an idempotent no-op instead.
       *
       * The two are different contracts and both are intentional:
       * `markOrderPaid` and `markOrderFulfilled` resolve with
       * `changed: false` (a retried webhook should not be an error), while
       * `cancelOrder` refuses with `already_cancelled`, because a
       * double-submitted destructive button is better answered honestly.
       */
      repeatCode: string | null;
      run: () => Promise<{ changed: boolean }>;
    }> = [
      {
        to: "PAID",
        repeatCode: null,
        run: () =>
          service.markOrderPaid(db, {
            orderId: order.id,
            actor: { id: "sys", source: "test" },
          }) as Promise<{ changed: boolean }>,
      },
      {
        to: "CANCELLED",
        repeatCode: "already_cancelled",
        run: () =>
          service.cancelOrder(db, { actorUserId: BUYER_A, orderId: order.id }) as Promise<{
            changed: boolean;
          }>,
      },
      {
        to: "SHIPPED",
        repeatCode: null,
        run: () =>
          service.markOrderFulfilled(db, "SHIPPED", {
            orderId: order.id,
            actorUserId: SELLER_1,
            actorSellerId: seller.id,
          }),
      },
      {
        to: "DELIVERED",
        repeatCode: null,
        run: () =>
          service.markOrderFulfilled(db, "DELIVERED", {
            orderId: order.id,
            actorUserId: SELLER_1,
            actorSellerId: seller.id,
          }),
      },
      {
        to: "COMPLETED",
        repeatCode: null,
        run: () =>
          service.markOrderFulfilled(db, "COMPLETED", {
            orderId: order.id,
            actorUserId: BUYER_A,
          }),
      },
    ];

    const fromStates: OrderStatus[] = [
      "PENDING",
      "CONFIRMED",
      "PAID",
      "SHIPPED",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED",
      "REFUNDED",
    ];

    let checked = 0;

    for (const from of fromStates) {
      for (const writer of writers) {
        // Force the starting state, then re-arm the hook so a failed claim
        // rolls back onto the forced value rather than the previous one.
        store.commitOrderStatus(order.id, from);
        const stockBefore = stockOf(productId);

        if (from === writer.to) {
          if (writer.repeatCode) {
            // The entry point answers a repeat with a refusal code rather
            // than a silent success.
            await assert.rejects(
              () => writer.run(),
              (error: unknown) =>
                error instanceof service.OrderTransitionError &&
                error.code === writer.repeatCode,
              `a repeated ${from} → ${writer.to} must refuse with ${writer.repeatCode}`
            );
          } else {
            // Idempotent replay: resolves, writes nothing.
            const result = await writer.run();
            assert.equal(
              result.changed,
              false,
              `${from} → ${writer.to} repeated must be a no-op, not a write`
            );
          }
          assert.equal(orderRow(order.id).status, from, `${from} must not move on a repeat`);
          assert.equal(stockOf(productId), stockBefore, `a repeated ${from} → ${writer.to} moved inventory`);
          checked++;
          continue;
        }

        if (canTransitionOrder(from, writer.to)) {
          // Legal, but out of scope here — see the note above.
          continue;
        }

        await assert.rejects(
          () => writer.run(),
          (error: unknown) =>
            error instanceof service.OrderTransitionError,
          `${from} → ${writer.to} must be refused by the service, not written`
        );

        assert.equal(
          orderRow(order.id).status,
          from,
          `${from} → ${writer.to} was refused, so the row must still be ${from}`
        );
        assert.equal(stockOf(productId), stockBefore, `${from} → ${writer.to} moved inventory`);
        checked++;
      }
    }

    // Every non-legal combination was actually exercised. 8 states × 5
    // writers = 40 pairs, minus the 5 legal ones and minus 5 self-pairs that
    // take the replay branch = 30 refusals + 5 replays.
    assert.equal(checked, 35, "the forbidden/replay matrix must be fully exercised");
  });
});
