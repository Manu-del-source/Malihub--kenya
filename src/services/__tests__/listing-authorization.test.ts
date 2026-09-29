import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  createFakeMarketplaceStore,
  seedCategory,
  seedProduct,
  seedSeller,
  type FakeMarketplaceStore,
} from "./fake-marketplace-store";

/**
 * Product ownership and wishlist rules, exercised against the REAL
 * `listing-service` with only the database substituted.
 *
 * `@/lib/prisma` is mocked at the module boundary (the pattern the auth
 * suites use in provider-mock.ts), so every function below — assertOwnership,
 * updateListing, deleteListing, toggleFavorite — runs its production code.
 * What these tests pin down:
 *
 *  - ownership is derived from the userId the SERVER passes in; a request
 *    that names someone else's product always fails, no matter who the
 *    caller claims to be;
 *  - a seller CAN create and manage their own products;
 *  - favourites are rows keyed by (userId, productId): one buyer toggling
 *    never disturbs another buyer's wishlist;
 *  - a forged product id fails cleanly instead of surfacing a raw FK error.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });

let service: typeof import("@/services/listing-service");

const OWNER = "seller-owner";
const INTRUDER = "seller-intruder";
const BUYER = "buyer-1";

function seedOwnedListing() {
  const seller = seedSeller(store, { userId: OWNER, businessName: "Owner Shop" });
  const category = seedCategory(store, "electronics");
  const product = seedProduct(store, {
    sellerId: seller.id,
    ownerId: OWNER,
    categoryId: category.id,
    title: "Original listing title",
    priceCents: 100_000,
    status: "ACTIVE",
    quantity: 4,
  });
  return { seller, category, product };
}

const LISTING_INPUT = {
  title: "Updated listing title",
  description: "A sufficiently detailed description for the validation rules.",
  categorySlug: "electronics",
  condition: "GOOD" as const,
  brand: "",
  priceCents: 90_000,
  isNegotiable: false,
  quantity: 6,
  county: "Nairobi" as const,
  town: "Westlands",
  contactPreference: "ANY" as const,
  images: [{ url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", cloudinaryId: "abc123" }],
  status: "ACTIVE" as const,
};

before(async () => {
  service = await import("@/services/listing-service");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  store.operations.length = 0;
  store.failNextOrderCreate = false;
  store.forceUpdateManyMiss = false;
});

describe("product management — sellers only touch their own listings", () => {
  it("a seller can create a product owned by their own user id", async () => {
    const seller = seedSeller(store, { userId: OWNER });
    seedCategory(store, "electronics");

    const product = await service.createListing(OWNER, seller.id, LISTING_INPUT);

    assert.equal(product.ownerId, OWNER);
    assert.equal(product.sellerId, seller.id);
    assert.equal(product.title, LISTING_INPUT.title);
    assert.equal(product.priceCents, 90_000);
    assert.equal(store.tables.products.size, 1);
    assert.equal(store.tables.productImages.size, 1);
  });

  it("the owner can update their own product", async () => {
    const { product } = seedOwnedListing();

    const updated = await service.updateListing(product.id, OWNER, LISTING_INPUT);

    assert.equal(updated.id, product.id);
    assert.equal(store.tables.products.get(product.id)!.priceCents, 90_000);
    assert.equal(store.tables.products.get(product.id)!.title, LISTING_INPUT.title);
  });

  it("ANOTHER seller cannot update someone else's product", async () => {
    const { product } = seedOwnedListing();

    await assert.rejects(
      () => service.updateListing(product.id, INTRUDER, LISTING_INPUT),
      (error: unknown) => error instanceof service.ListingServiceError
    );
    // Nothing changed.
    const row = store.tables.products.get(product.id)!;
    assert.equal(row.priceCents, 100_000);
    assert.equal(row.title, "Original listing title");
  });

  it("a seller cannot delete a product they do not own", async () => {
    const { product } = seedOwnedListing();

    await assert.rejects(
      () => service.deleteListing(product.id, INTRUDER),
      (error: unknown) => error instanceof service.ListingServiceError
    );
    assert.equal(store.tables.products.get(product.id)!.status, "ACTIVE");
  });

  it("a buyer cannot delete a product at all", async () => {
    const { product } = seedOwnedListing();

    await assert.rejects(
      () => service.deleteListing(product.id, BUYER),
      (error: unknown) => error instanceof service.ListingServiceError
    );
    assert.equal(store.tables.products.get(product.id)!.status, "ACTIVE");
  });

  it("the owner's delete is a soft delete to REMOVED, preserving order history", async () => {
    const { product } = seedOwnedListing();

    await service.deleteListing(product.id, OWNER);

    assert.equal(store.tables.products.get(product.id)!.status, "REMOVED");
    assert.ok(store.tables.products.has(product.id)); // row survives
  });

  it("update fails cleanly for a forged product id", async () => {
    await assert.rejects(
      () => service.updateListing("prod-does-not-exist", OWNER, LISTING_INPUT),
      (error: unknown) => error instanceof service.ListingServiceError
    );
  });
});

describe("wishlist — favorites are keyed by the caller's identity", () => {
  it("a buyer can add a product to their own wishlist", async () => {
    const { product } = seedOwnedListing();

    const result = await service.toggleFavorite(BUYER, product.id);

    assert.deepEqual(result, { favorited: true });
    const rows = [...store.tables.wishlists.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, BUYER);
    assert.equal(rows[0]!.productId, product.id);
    assert.equal(store.tables.products.get(product.id)!.favoriteCount, 1);
  });

  it("toggling again removes the buyer's own row", async () => {
    const { product } = seedOwnedListing();
    await service.toggleFavorite(BUYER, product.id);

    const result = await service.toggleFavorite(BUYER, product.id);

    assert.deepEqual(result, { favorited: false });
    assert.equal(store.tables.wishlists.size, 0);
    assert.equal(store.tables.products.get(product.id)!.favoriteCount, 0);
  });

  it("one buyer's toggle never touches another buyer's favorites", async () => {
    const { product } = seedOwnedListing();
    await service.toggleFavorite(BUYER, product.id);

    // A second buyer toggles the SAME product: their row is added, the first
    // buyer's row remains untouched.
    await service.toggleFavorite("buyer-2", product.id);

    const rows = [...store.tables.wishlists.values()];
    assert.equal(rows.length, 2);
    assert.ok(rows.some((row) => row.userId === BUYER));
    assert.ok(rows.some((row) => row.userId === "buyer-2"));
  });

  it("rejects favoriting a product that does not exist", async () => {
    await assert.rejects(
      () => service.toggleFavorite(BUYER, "prod-missing"),
      (error: unknown) => error instanceof service.ListingServiceError
    );
    assert.equal(store.tables.wishlists.size, 0);
  });
});
