import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// `order-service` is server-only code; substitute the marker module before the
// module under test is loaded (mock.module must run first — the same pattern
// provider-mock.ts documents for the auth suites).
mock.module("server-only", { namedExports: {} });

let service: typeof import("@/services/order-service");

import {
  asOrderStore,
  createFakeMarketplaceStore,
  seedCartItem,
  seedCategory,
  seedProduct,
  seedProfile,
  seedSeller,
  type FakeMarketplaceStore,
} from "./fake-marketplace-store";

/**
 * Checkout and order-ownership behaviour against the real service.
 *
 * The invariants under test are the ones a payment phase will build on:
 *  - an order is created ONLY from database state keyed by the caller's
 *    session identity — there is no price, seller or ownership input at all;
 *  - a multi-seller cart splits into one order per seller (Order.sellerId is
 *    denormalized and non-nullable by design);
 *  - any listing that turned inactive or sold out mid-checkout rolls the
 *    whole transaction back — never a partial order;
 *  - every read is scoped: buyer A can't fetch buyer B's order, and seller 1
 *    can't fetch seller 2's order, even with the exact order id.
 */

let store: FakeMarketplaceStore;
let db: ReturnType<typeof asOrderStore>;

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";

function seedSellerListing(
  userId: string,
  overrides: { quantity?: number; priceCents?: number; status?: string } = {}
) {
  const seller = seedSeller(store, { userId, businessName: `${userId} shop` });
  seedProfile(store, userId, "Seller Person");
  const category = seedCategory(store, `cat-${userId}`);
  const product = seedProduct(store, {
    sellerId: seller.id,
    ownerId: userId,
    categoryId: category.id,
    quantity: overrides.quantity ?? 5,
    priceCents: overrides.priceCents ?? 100_000,
    status: overrides.status ?? "ACTIVE",
  });
  return { seller, product };
}

before(async () => {
  service = await import("@/services/order-service");
});

beforeEach(() => {
  store = createFakeMarketplaceStore();
  db = asOrderStore(store);
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedProfile(store, BUYER_B, "Grace Atieno");
});

describe("checkout — cart becomes orders", () => {
  it("creates one PENDING order per seller with server-side totals", async () => {
    const first = seedSellerListing("seller-1", { priceCents: 100_000 });
    const second = seedSellerListing("seller-2", { priceCents: 250_000 });
    seedCartItem(store, BUYER_A, first.product.id, 2);
    seedCartItem(store, BUYER_A, second.product.id, 1);

    const result = await service.checkoutCart(db, BUYER_A);

    assert.equal(result.orders.length, 2);
    const bySeller = new Map(result.orders.map((o) => [o.sellerId, o]));
    const firstOrder = bySeller.get(first.seller.id)!;
    const secondOrder = bySeller.get(second.seller.id)!;

    // Totals come from the product rows, never from the caller.
    assert.equal(firstOrder.subtotalCents, 200_000);
    assert.equal(firstOrder.totalCents, 200_000);
    assert.equal(secondOrder.subtotalCents, 250_000);
    assert.equal(firstOrder.status, "PENDING");

    for (const order of result.orders) {
      assert.match(order.orderNumber, /^MH-/);
    }

    // Cart cleared, inventory decremented.
    assert.equal(store.tables.cartItems.size, 0);
    assert.equal(store.tables.products.get(first.product.id)!.quantity, 3);
    assert.equal(store.tables.products.get(second.product.id)!.quantity, 4);
  });

  it("records order items with the database unit price and quantities", async () => {
    const { product } = seedSellerListing("seller-1", { priceCents: 49_999 });
    seedCartItem(store, BUYER_A, product.id, 3);

    await service.checkoutCart(db, BUYER_A);

    const items = [...store.tables.orderItems.values()];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.unitPriceCents, 49_999);
    assert.equal(items[0]!.quantity, 3);
    assert.equal(items[0]!.totalCents, 149_997);
  });

  it("retries an order-number collision instead of failing the checkout", async () => {
    const { product } = seedSellerListing("seller-1");
    seedCartItem(store, BUYER_A, product.id, 1);
    store.failNextOrderCreate = true;

    const result = await service.checkoutCart(db, BUYER_A);
    assert.equal(result.orders.length, 1);
    assert.match(result.orders[0]!.orderNumber, /^MH-/);
    // The first attempt rolled back completely: stock was decremented
    // exactly once, not once per attempt.
    assert.equal(store.tables.products.get(product.id)!.quantity, 4);
    assert.equal(store.tables.cartItems.size, 0);
  });

  it("rejects a checkout that loses its cart to a concurrent checkout", async () => {
    // Two POST /api/orders for the same cart (double-click, second tab):
    // both read the cart, then the WINNER's transaction commits between the
    // loser's pre-transaction read and its transaction opening. The loser
    // must fail the in-transaction cart claim BEFORE any stock moves —
    // without the claim both would pass their stock guards (stock 10 > 2
    // needed) and commit duplicate orders.
    const { product } = seedSellerListing("seller-1", { quantity: 10 });
    seedCartItem(store, BUYER_A, product.id, 2);

    store.beforeTransaction = () => {
      for (const [id, row] of [...store.tables.cartItems.entries()]) {
        if (row.userId === BUYER_A) store.tables.cartItems.delete(id);
      }
    };

    await assert.rejects(
      () => service.checkoutCart(db, BUYER_A),
      (error: unknown) => error instanceof service.OrderError && error.code === "unavailable"
    );

    assert.equal(store.tables.orders.size, 0, "the loser must create no orders");
    assert.equal(store.tables.orderItems.size, 0);
    assert.equal(store.tables.products.get(product.id)!.quantity, 10, "stock untouched");
    assert.equal(store.tables.cartItems.size, 0, "the winner's cart deletion persists");
  });

  it("rejects an empty cart", async () => {
    await assert.rejects(
      () => service.checkoutCart(db, BUYER_A),
      (error: unknown) => error instanceof service.OrderError && error.code === "empty_cart"
    );
    assert.equal(store.tables.orders.size, 0);
  });

  it("rejects a cart holding a listing that is no longer active, creating nothing", async () => {
    const { product } = seedSellerListing("seller-1", { status: "ARCHIVED" });
    seedCartItem(store, BUYER_A, product.id, 1);

    await assert.rejects(
      () => service.checkoutCart(db, BUYER_A),
      (error: unknown) => error instanceof service.OrderError && error.code === "unavailable"
    );
    assert.equal(store.tables.orders.size, 0);
    assert.equal(store.tables.cartItems.size, 1); // cart untouched
    assert.equal(store.tables.products.get(product.id)!.quantity, 5); // stock untouched
  });

  it("rejects a quantity that exceeds stock, creating nothing", async () => {
    const { product } = seedSellerListing("seller-1", { quantity: 2 });
    seedCartItem(store, BUYER_A, product.id, 3);

    await assert.rejects(
      () => service.checkoutCart(db, BUYER_A),
      (error: unknown) => error instanceof service.OrderError && error.code === "unavailable"
    );
    assert.equal(store.tables.orders.size, 0);
    assert.equal(store.tables.cartItems.size, 1);
  });

  it("rolls the ENTIRE checkout back when a listing sells out inside the transaction", async () => {
    const first = seedSellerListing("seller-1");
    const second = seedSellerListing("seller-2");
    seedCartItem(store, BUYER_A, first.product.id, 1);
    seedCartItem(store, BUYER_A, second.product.id, 1);

    // The first seller's guard succeeds; the second seller's listing races to
    // zero. updateMany returning count 0 is exactly that race.
    const originalUpdateMany = store.product.updateMany.bind(store.product);
    let calls = 0;
    store.product.updateMany = async (args) => {
      calls++;
      if (calls === 2) return { count: 0 };
      return originalUpdateMany(args);
    };

    try {
      await assert.rejects(
        () => service.checkoutCart(db, BUYER_A),
        (error: unknown) => error instanceof service.OrderError && error.code === "unavailable"
      );
    } finally {
      store.product.updateMany = originalUpdateMany;
    }

    // Transaction rolled back: no orders, cart intact, first stock restored.
    assert.equal(store.tables.orders.size, 0);
    assert.equal(store.tables.cartItems.size, 2);
    assert.equal(store.tables.products.get(first.product.id)!.quantity, 5);
    assert.equal(store.tables.products.get(second.product.id)!.quantity, 5);
  });
});

describe("buyer orders — scoped to the session's user", () => {
  it("lists only this buyer's orders", async () => {
    const { product } = seedSellerListing("seller-1");
    seedCartItem(store, BUYER_A, product.id, 1);
    await service.checkoutCart(db, BUYER_A);
    seedCartItem(store, BUYER_B, product.id, 1);
    await service.checkoutCart(db, BUYER_B);

    const ordersA = await service.listBuyerOrders(db, BUYER_A);
    const ordersB = await service.listBuyerOrders(db, BUYER_B);

    assert.equal(ordersA.length, 1);
    assert.equal(ordersB.length, 1);
    assert.equal(store.tables.orders.get(ordersA[0]!.id)!.buyerId, BUYER_A);
    assert.equal(store.tables.orders.get(ordersB[0]!.id)!.buyerId, BUYER_B);
    assert.notEqual(ordersA[0]!.id, ordersB[0]!.id);
  });

  it("returns null when one buyer probes another buyer's order id", async () => {
    const { product } = seedSellerListing("seller-1");
    seedCartItem(store, BUYER_A, product.id, 1);
    const checkout = await service.checkoutCart(db, BUYER_A);
    const orderId = checkout.orders[0]!.id;

    const own = await service.getBuyerOrder(db, BUYER_A, orderId);
    assert.ok(own);

    const other = await service.getBuyerOrder(db, BUYER_B, orderId);
    assert.equal(other, null);

    const missing = await service.getBuyerOrder(db, BUYER_A, "ord-does-not-exist");
    assert.equal(missing, null);
  });
});

describe("seller orders — scoped to the caller's own sellers row", () => {
  it("lists only orders for this seller's listings", async () => {
    const sellerOne = seedSellerListing("seller-1");
    const sellerTwo = seedSellerListing("seller-2");
    seedCartItem(store, BUYER_A, sellerOne.product.id, 1);
    await service.checkoutCart(db, BUYER_A);
    seedCartItem(store, BUYER_B, sellerTwo.product.id, 1);
    await service.checkoutCart(db, BUYER_B);

    const orders1 = await service.listSellerOrders(db, "seller-1");
    const orders2 = await service.listSellerOrders(db, "seller-2");

    assert.equal(orders1!.length, 1);
    assert.equal(orders1![0]!.sellerId, sellerOne.seller.id);
    assert.equal(orders2!.length, 1);
    assert.equal(orders2![0]!.sellerId, sellerTwo.seller.id);
  });

  it("returns null for an account with no sellers row", async () => {
    assert.equal(await service.listSellerOrders(db, "nobody"), null);
    assert.equal(await service.getSellerOrder(db, "nobody", "ord-1"), null);
  });

  it("returns null when one seller probes another seller's order id", async () => {
    const sellerOne = seedSellerListing("seller-1");
    seedSellerListing("seller-2");
    seedCartItem(store, BUYER_A, sellerOne.product.id, 1);
    const checkout = await service.checkoutCart(db, BUYER_A);
    const orderId = checkout.orders[0]!.id;

    assert.ok(await service.getSellerOrder(db, "seller-1", orderId));
    assert.equal(await service.getSellerOrder(db, "seller-2", orderId), null);
  });

  it("reads the sales snapshot only from the caller's own rows", async () => {
    const sellerOne = seedSellerListing("seller-1");
    seedSellerListing("seller-2");
    seedCartItem(store, BUYER_A, sellerOne.product.id, 2);
    await service.checkoutCart(db, BUYER_A);

    const snapshot = await service.getSellerSalesSnapshot(db, "seller-1");
    assert.ok(snapshot);
    assert.equal(snapshot.totalOrders, 1);
    assert.equal(snapshot.pendingOrders, 1);
    assert.equal(snapshot.paidOrders, 0);
    assert.equal(snapshot.paidRevenueCents, 0); // nothing is "paid" until payments exist
    assert.equal(snapshot.unitsSold, 2);

    const other = await service.getSellerSalesSnapshot(db, "seller-2");
    assert.ok(other);
    assert.equal(other.totalOrders, 0);

    assert.equal(await service.getSellerSalesSnapshot(db, "nobody"), null);
  });
});

describe("order response minimization", () => {
  it("keeps supplier snapshots server-side for buyer and seller views", async () => {
    const { product } = seedSellerListing("seller-1");
    seedCartItem(store, BUYER_A, product.id, 2);
    const { orders } = await service.checkoutCart(db, BUYER_A);
    const orderId = orders[0]!.id;
    const item = [...store.tables.orderItems.values()][0]!;
    item.supplierProductId = "internal-supplier-product";
    item.supplierProductTitle = "internal-supplier-title";
    item.supplierSku = "internal-supplier-sku";
    Object.assign(store.tables.orders.get(orderId)!, { notes: "private-fulfilment-note" });
    store.tables.productImages.set("photo", {
      id: "photo", productId: product.id, url: "https://images.example/item.jpg",
      cloudinaryId: "private-storage-id", sortOrder: 0, isPrimary: true,
    });

    const buyer = await service.getBuyerOrder(db, BUYER_A, orderId);
    const seller = await service.getSellerOrder(db, "seller-1", orderId);
    assert.ok(buyer);
    assert.ok(seller);
    for (const view of [buyer, seller]) {
      assert.equal(view.orderNumber, orders[0]!.orderNumber);
      assert.equal(view.totalCents, 200_000);
      assert.equal(view.items[0]!.quantity, 2);
      assert.equal(view.items[0]!.product.title, product.title);
      assert.deepEqual(view.items[0]!.product.images, [{ url: "https://images.example/item.jpg" }]);
      assert.equal("notes" in view, false);
      assert.equal("buyerId" in view, false);
      for (const key of ["supplierProductId", "supplierProductTitle", "supplierSku"]) {
        assert.equal(key in view.items[0]!, false, key);
      }
    }
    assert.equal(buyer.seller.businessName, "seller-1 shop");
    assert.equal("buyer" in buyer, false);
    assert.equal(seller.buyer.profile?.fullName, "Emmanuel Yegon");
    assert.equal("seller" in seller, false);
    assert.equal(await service.getBuyerOrder(db, BUYER_B, orderId), null);
    assert.equal(await service.getSellerOrder(db, "another-seller", orderId), null);
    // Checkout's supplier snapshot still exists for trusted fulfilment code.
    assert.equal(item.supplierSku, "internal-supplier-sku");
  });
});
