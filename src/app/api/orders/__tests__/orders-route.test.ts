import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakeMarketplaceStore, asOrderStore, seedCartItem, seedCategory, seedProduct, seedSeller } from "@/services/__tests__/fake-marketplace-store";

const store = createFakeMarketplaceStore();
let user: { id: string; email: string } | null = null;
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => user ? { user } : null } });
let route: typeof import("@/app/api/orders/route");
let orders: typeof import("@/services/order-service");

before(async () => {
  route = await import("@/app/api/orders/route");
  orders = await import("@/services/order-service");
});
beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  user = null;
});

describe("GET /api/orders buyer boundary", () => {
  it("requires a session", async () => {
    assert.equal((await route.GET()).status, 401);
  });

  it("returns only the session buyer's order without nested supplier data", async () => {
    const seller = seedSeller(store, { userId: "seller" });
    const category = seedCategory(store);
    const product = seedProduct(store, { sellerId: seller.id, ownerId: seller.userId, categoryId: category.id });
    seedCartItem(store, "buyer-a", product.id, 1);
    const created = await orders.checkoutCart(asOrderStore(store), "buyer-a");
    const item = [...store.tables.orderItems.values()][0]!;
    item.supplierSku = "private-sku";
    item.supplierProductId = "private-supplier-id";
    user = { id: "buyer-b", email: "b@example.com" };
    assert.deepEqual((await (await route.GET()).json()).data, []);
    user = { id: "buyer-a", email: "a@example.com" };
    const response = await route.GET();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data[0].id, created.orders[0]!.id);
    assert.equal(payload.data[0].totalCents, product.priceCents);
    assert.equal(payload.data[0].items[0].product.title, product.title);
    assert.equal("supplierSku" in payload.data[0].items[0], false);
    assert.equal("supplierProductId" in payload.data[0].items[0], false);
    assert.equal("buyerId" in payload.data[0], false);
  });
});
