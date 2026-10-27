import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { toListingCardData } from "@/lib/mappers";

// Deliberately return more than Prisma's requested select: the serializer must
// remain safe even if a future query/mock accidentally adds a private field.
const product = {
  id: "11111111-1111-4111-8111-111111111111",
  sellerId: "seller-a",
  ownerId: "private-owner",
  supplierProductId: "private-supplier-product",
  supplierCost: 12,
  slug: "coffee-pot",
  title: "Coffee pot",
  description: "A handmade coffee pot.",
  priceCents: 125000,
  isNegotiable: true,
  condition: "NEW",
  brand: "Mali",
  quantity: 3,
  contactPreference: "CHAT",
  county: "Nairobi",
  subCounty: "Westlands",
  status: "ACTIVE",
  favoriteCount: 2,
  images: [{ url: "https://images.example/pot.jpg", cloudinaryId: "private-storage-id" }],
  category: { id: "category-a", name: "Kitchen", slug: "kitchen", internalNote: "private" },
  seller: {
    businessName: "Pottery Shop", slug: "pottery-shop", logoUrl: null,
    verificationStatus: "VERIFIED", ratingAverage: 4.5, ratingCount: 10,
    county: "Nairobi", userId: "private-user", kraPin: "private-tax-id",
    idDocumentUrl: "private-document",
  },
};

let lastQuery: Record<string, unknown> | undefined;
let verifiedSeller = true;
const db = {
  $queryRaw: async () => [{ id: product.id, sort_value: "2026-01-01" }],
  product: {
    findMany: async (args: Record<string, unknown>) => {
      lastQuery = args;
      return [product];
    },
  },
  seller: {
    findUnique: async () => ({
      id: "seller-a", businessName: "Pottery Shop",
      verificationStatus: verifiedSeller ? "VERIFIED" : "PENDING",
      ratingAverage: 4.5, ratingCount: 10, county: "Nairobi", kraPin: "private-tax-id",
    }),
  },
};

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: db } });
mock.module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => null, isAdministratorRole: () => false },
});

let productsRoute: typeof import("@/app/api/products/route");
let searchRoute: typeof import("@/app/api/search/route");
let sellerRoute: typeof import("@/app/api/sellers/[slug]/listings/route");

before(async () => {
  productsRoute = await import("@/app/api/products/route");
  searchRoute = await import("@/app/api/search/route");
  sellerRoute = await import("@/app/api/sellers/[slug]/listings/route");
});
beforeEach(() => { lastQuery = undefined; verifiedSeller = true; });

function assertPublic(item: typeof product) {
  assert.equal(item.title, "Coffee pot");
  assert.equal(item.description, "A handmade coffee pot.");
  assert.equal(item.priceCents, 125000);
  assert.equal(item.quantity, 3);
  assert.equal(item.category.name, "Kitchen");
  assert.equal(item.seller.businessName, "Pottery Shop");
  assert.deepEqual(item.images, [{ url: "https://images.example/pot.jpg" }]);
  for (const key of ["ownerId", "sellerId", "supplierProductId", "supplierCost"]) {
    assert.equal(key in item, false, key);
  }
  for (const key of ["kraPin", "userId", "idDocumentUrl"]) {
    assert.equal(key in item.seller, false, key);
  }
  assert.equal("internalNote" in item.category, false);
  const select = lastQuery?.select as Record<string, unknown>;
  assert.ok(select);
  assert.equal("ownerId" in select, false);
  assert.equal("supplierProductId" in select, false);
}

describe("public listing/search DTOs", () => {
  it("product list and search expose the same safe product shape", async () => {
    for (const handler of [productsRoute.GET, searchRoute.GET]) {
      const response = await handler(new NextRequest("http://localhost/api/search?q=coffee"));
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assertPublic(data.items[0]);
      const card = toListingCardData(data.items[0]);
      assert.equal(card.title, "Coffee pot");
      assert.equal(card.imageUrl, "https://images.example/pot.jpg");
      assert.equal(card.sellerName, "Pottery Shop");
      assert.equal(card.isVerifiedSeller, true);
      assert.equal(data.hasMore, false);
      const where = lastQuery?.where as Record<string, unknown>;
      assert.equal(where.status, "ACTIVE");
      assert.deepEqual(where.seller, { verificationStatus: "VERIFIED" });
    }
  });

  it("public seller listings are seller-scoped and omit private nested fields", async () => {
    const response = await sellerRoute.GET(new NextRequest("http://localhost/api/sellers/pottery-shop/listings"), {
      params: Promise.resolve({ slug: "pottery-shop" }),
    });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.seller.businessName, "Pottery Shop");
    assert.equal("kraPin" in data.seller, false);
    assertPublic(data.listings[0]);
    const where = lastQuery?.where as Record<string, unknown>;
    assert.equal(where.sellerId, "seller-a");
    assert.equal(where.status, "ACTIVE");
    assert.deepEqual(where.seller, { verificationStatus: "VERIFIED" });
  });

  it("does not publish an unverified seller's listings", async () => {
    verifiedSeller = false;
    const response = await sellerRoute.GET(new NextRequest("http://localhost/api/sellers/pottery-shop/listings"), {
      params: Promise.resolve({ slug: "pottery-shop" }),
    });
    assert.equal(response.status, 404);
    assert.equal(lastQuery, undefined);
  });
});
