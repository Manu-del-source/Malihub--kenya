import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// `cart-service` is server-only code; substitute the marker module before the
// module under test is loaded (mock.module must run first — the same pattern
// provider-mock.ts documents for the auth suites).
mock.module("server-only", { namedExports: {} });

let service: typeof import("@/services/cart-service");

import {
  asCartStore,
  createFakeMarketplaceStore,
  seedCartItem,
  seedProduct,
  seedCategory,
  seedSeller,
  type FakeMarketplaceStore,
} from "./fake-marketplace-store";

/**
 * Cart behaviour against the real service, with the database substituted.
 *
 * The assertions that matter here are the ownership ones: every read and
 * write is scoped by the `userId` the *server* passes in, so one buyer's cart
 * is invisible to — and untouchable by — another buyer even though both
 * identities are simply arguments to the same functions. Quantity and
 * availability rules are re-checked on every mutation, because a cart row can
 * outlive the listing conditions it was added under.
 */

let store: FakeMarketplaceStore;
let db: ReturnType<typeof asCartStore>;

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";

function seedActiveListing(quantity = 5, priceCents = 120_000) {
  const seller = seedSeller(store, { userId: "seller-1" });
  const category = seedCategory(store);
  return seedProduct(store, {
    sellerId: seller.id,
    ownerId: seller.userId,
    categoryId: category.id,
    quantity,
    priceCents,
    status: "ACTIVE",
  });
}

before(async () => {
  service = await import("@/services/cart-service");
});

beforeEach(() => {
  store = createFakeMarketplaceStore();
  db = asCartStore(store);
});

describe("cart — adding items", () => {
  it("adds a product to the buyer's own cart with a valid quantity", async () => {
    const product = seedActiveListing();

    const cart = await service.addToCart(db, BUYER_A, product.id, 2);

    assert.equal(cart.itemCount, 1);
    assert.equal(cart.items[0]!.quantity, 2);
    assert.equal(cart.subtotalCents, 120_000 * 2);
    const rows = [...store.tables.cartItems.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, BUYER_A);
  });

  it("merges the add when a concurrent request creates the row first", async () => {
    const product = seedActiveListing(5);

    // A rival request won the first-add race and the row is already there —
    // but OUR first read misses it (it committed after our SELECT). The
    // create then hits the (userId, productId) unique index; the service
    // must recover by merging, not surface a raw constraint error.
    seedCartItem(store, BUYER_A, product.id, 2);

    let missNextRead = true;
    const racedDb = {
      cartItem: {
        ...store.cartItem,
        findUnique: async (args: Parameters<typeof store.cartItem.findUnique>[0]) => {
          if (missNextRead) {
            missNextRead = false;
            return null;
          }
          return store.cartItem.findUnique(args);
        },
      },
      product: store.product,
    } as unknown as ReturnType<typeof asCartStore>;

    const cart = await service.addToCart(racedDb, BUYER_A, product.id, 2);

    const rows = [...store.tables.cartItems.values()];
    assert.equal(rows.length, 1, "the unique index means exactly one row");
    assert.equal(rows[0]!.quantity, 4, "the losing add merged into the raced row");
    assert.equal(cart.itemCount, 1);
    assert.equal(cart.items[0]!.quantity, 4);
  });

  it("rejects a product that does not exist", async () => {
    await assert.rejects(
      () => service.addToCart(db, BUYER_A, "prod-missing", 1),
      (error: unknown) => error instanceof service.CartError && error.code === "not_found"
    );
  });

  it("rejects an unavailable (non-ACTIVE) product", async () => {
    const product = seedActiveListing();
    product.status = "SOLD";

    await assert.rejects(
      () => service.addToCart(db, BUYER_A, product.id, 1),
      (error: unknown) => error instanceof service.CartError && error.code === "unavailable"
    );
    assert.equal(store.tables.cartItems.size, 0);
  });

  it("rejects an invalid quantity (0, negative, fractional)", async () => {
    const product = seedActiveListing();
    for (const quantity of [0, -3, 1.5]) {
      await assert.rejects(
        () => service.addToCart(db, BUYER_A, product.id, quantity),
        (error: unknown) => error instanceof service.CartError && error.code === "invalid",
        `quantity ${quantity} should be rejected`
      );
    }
    assert.equal(store.tables.cartItems.size, 0);
  });

  it("rejects a quantity beyond available inventory", async () => {
    const product = seedActiveListing(3);

    await assert.rejects(
      () => service.addToCart(db, BUYER_A, product.id, 4),
      (error: unknown) => error instanceof service.CartError && error.code === "unavailable"
    );
    assert.equal(store.tables.cartItems.size, 0);
  });

  it("sums a second add into the existing row but never past the stock cap", async () => {
    const product = seedActiveListing(5);

    await service.addToCart(db, BUYER_A, product.id, 3);
    const cart = await service.addToCart(db, BUYER_A, product.id, 2);
    assert.equal(cart.items[0]!.quantity, 5);
    assert.equal(store.tables.cartItems.size, 1);

    await assert.rejects(
      () => service.addToCart(db, BUYER_A, product.id, 1),
      (error: unknown) => error instanceof service.CartError && error.code === "unavailable"
    );
  });
});

describe("cart — changing and removing items", () => {
  it("sets an absolute quantity for an item already in the cart", async () => {
    const product = seedActiveListing();
    await service.addToCart(db, BUYER_A, product.id, 1);

    const cart = await service.updateCartItem(db, BUYER_A, product.id, 4);
    assert.equal(cart.items[0]!.quantity, 4);
  });

  it("rejects changing to an invalid quantity", async () => {
    const product = seedActiveListing();
    await service.addToCart(db, BUYER_A, product.id, 1);

    for (const quantity of [0, -1, 2.5]) {
      await assert.rejects(
        () => service.updateCartItem(db, BUYER_A, product.id, quantity),
        (error: unknown) => error instanceof service.CartError && error.code === "invalid"
      );
    }
  });

  it("rejects raising a quantity past current stock", async () => {
    const product = seedActiveListing(2);
    await service.addToCart(db, BUYER_A, product.id, 1);

    await assert.rejects(
      () => service.updateCartItem(db, BUYER_A, product.id, 3),
      (error: unknown) => error instanceof service.CartError && error.code === "unavailable"
    );
  });

  it("rejects updating a product that is not in the buyer's cart", async () => {
    const product = seedActiveListing();
    await assert.rejects(
      () => service.updateCartItem(db, BUYER_A, product.id, 1),
      (error: unknown) => error instanceof service.CartError && error.code === "not_found"
    );
  });

  it("rejects updating an item whose listing went inactive", async () => {
    const product = seedActiveListing();
    await service.addToCart(db, BUYER_A, product.id, 1);
    product.status = "ARCHIVED";

    await assert.rejects(
      () => service.updateCartItem(db, BUYER_A, product.id, 2),
      (error: unknown) => error instanceof service.CartError && error.code === "unavailable"
    );
  });

  it("removes an item from the buyer's own cart", async () => {
    const product = seedActiveListing();
    await service.addToCart(db, BUYER_A, product.id, 1);

    const cart = await service.removeFromCart(db, BUYER_A, product.id);
    assert.equal(cart.itemCount, 0);
    assert.equal(store.tables.cartItems.size, 0);
  });
});

describe("cart — ownership is derived from the caller's identity", () => {
  it("a buyer only ever sees their own cart", async () => {
    const product = seedActiveListing();
    seedCartItem(store, BUYER_A, product.id, 3);

    const cartB = await service.getCart(db, BUYER_B);
    assert.equal(cartB.itemCount, 0);
    assert.equal(cartB.subtotalCents, 0);

    const cartA = await service.getCart(db, BUYER_A);
    assert.equal(cartA.itemCount, 1);
    assert.equal(cartA.items[0]!.quantity, 3);
  });

  it("another buyer cannot remove a buyer's cart item", async () => {
    const product = seedActiveListing();
    seedCartItem(store, BUYER_A, product.id, 3);

    // Buyer B "removes" the product — scoped to B's userId, so A's row survives.
    await service.removeFromCart(db, BUYER_B, product.id);

    assert.equal(store.tables.cartItems.size, 1);
    assert.equal([...store.tables.cartItems.values()][0]!.userId, BUYER_A);
  });

  it("another buyer cannot change a buyer's cart quantity", async () => {
    const product = seedActiveListing();
    seedCartItem(store, BUYER_A, product.id, 3);

    await assert.rejects(() => service.updateCartItem(db, BUYER_B, product.id, 1));
    assert.equal([...store.tables.cartItems.values()][0]!.quantity, 3);
  });
});

describe("cart — summary", () => {
  it("counts only ACTIVE lines and prices them from the product rows", async () => {
    const active = seedActiveListing(5, 100_000);
    const inactive = seedActiveListing(5, 50_000);
    inactive.status = "REMOVED";

    seedCartItem(store, BUYER_A, active.id, 2);
    seedCartItem(store, BUYER_A, inactive.id, 2);

    const summary = await service.getCartSummary(db, BUYER_A);
    assert.equal(summary.itemCount, 1);
    assert.equal(summary.subtotalCents, 200_000);
  });

  it("is scoped to the requesting buyer", async () => {
    const product = seedActiveListing();
    seedCartItem(store, BUYER_A, product.id, 2);
    seedCartItem(store, BUYER_B, product.id, 3);

    const summary = await service.getCartSummary(db, BUYER_B);
    assert.equal(summary.itemCount, 1);
    assert.equal(summary.subtotalCents, 360_000);
  });
});
