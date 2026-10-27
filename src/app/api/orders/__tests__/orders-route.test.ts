import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

let query: Record<string, unknown> | null = null;
const database = {
  order: {
    findMany: async (args: Record<string, unknown>) => {
      query = args;
      return [{
        id: "order-1", orderNumber: "MH-12345678", buyerId: "buyer-1", sellerId: "seller-1",
        status: "PENDING", subtotalCents: 12500, totalCents: 12500,
        deliveryCounty: "Nairobi", deliveryAddress: "Example address", payoutEligibleAt: new Date(),
        items: [{
          id: "item-1", quantity: 1, unitPriceCents: 12500, totalCents: 12500,
          supplierProductId: "supplier-product-id", supplierProductTitle: "internal title", supplierSku: "internal sku",
          product: { title: "Lamp", slug: "lamp", condition: "NEW", ownerId: "owner-id", supplierProductId: "supplier-product-id", images: [{ url: "https://example.com/lamp.jpg", cloudinaryId: "storage-id" }] },
        }],
        seller: { businessName: "Seller", slug: "seller", userId: "seller-user-id" },
        buyer: { id: "buyer-1", email: "buyer@example.com" },
      }];
    },
  },
};

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: database } });
mock.module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => ({ user: { id: "buyer-1" } }) },
});

let route: typeof import("@/app/api/orders/route");

before(async () => {
  route = await import("@/app/api/orders/route");
});

beforeEach(() => {
  query = null;
});

describe("GET /api/orders response projection", () => {
  it("scopes reads to the session buyer and omits supplier and internal fields", async () => {
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.deepEqual(query?.where, { buyerId: "buyer-1" });
    const select = query?.select as Record<string, unknown>;
    assert.equal("buyerId" in select, false);
    assert.equal("sellerId" in select, false);
    const payload = await response.json();
    const text = JSON.stringify(payload);
    for (const privateField of ["buyerId", "sellerId", "supplierProductId", "supplierProductTitle", "supplierSku", "ownerId", "cloudinaryId", "payoutEligibleAt", "userId", "email"]) {
      assert.equal(text.includes(privateField), false, `${privateField} must not be serialized`);
    }
    assert.equal(payload.data[0].items[0].product.title, "Lamp");
    assert.equal(payload.data[0].items[0].product.images[0].url, "https://example.com/lamp.jpg");
  });
});
