import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  asOrderStore,
  createFakeMarketplaceStore,
  seedCartItem,
  seedCategory,
  seedProduct,
  seedSeller,
} from "@/services/__tests__/fake-marketplace-store";

const store = createFakeMarketplaceStore();
let user: { id: string; email: string } | null = null;

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });
mock.module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => (user ? { user } : null) },
});

let route: typeof import("@/app/api/orders/route");
let orders: typeof import("@/modules/orders/service");

before(async () => {
  route = await import("@/app/api/orders/route");
  orders = await import("@/modules/orders/service");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  user = null;
});

describe("GET /api/orders buyer boundary and response projection", () => {
  it("requires a session", async () => {
    assert.equal((await route.GET()).status, 401);
  });

  it("scopes reads to the session buyer and omits supplier and internal fields", async () => {
    const seller = seedSeller(store, { userId: "seller-user" });
    const category = seedCategory(store);
    const product = seedProduct(store, {
      sellerId: seller.id,
      ownerId: seller.userId,
      categoryId: category.id,
    });
    store.tables.productImages.set("image-1", {
      id: "image-1",
      productId: product.id,
      url: "https://example.com/image.jpg",
      cloudinaryId: "private-storage-id",
      sortOrder: 0,
      isPrimary: true,
    });
    seedCartItem(store, "buyer-a", product.id, 1);
    const created = await orders.checkoutCart(asOrderStore(store), "buyer-a");

    const orderItem = [...store.tables.orderItems.values()][0]!;
    orderItem.supplierSku = "private-sku";
    orderItem.supplierProductId = "private-supplier-id";
    orderItem.supplierProductTitle = "internal title";

    user = { id: "buyer-b", email: "buyer-b@example.com" };
    assert.deepEqual((await (await route.GET()).json()).data, []);

    user = { id: "buyer-a", email: "buyer-a@example.com" };
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data[0].id, created.orders[0]!.id);
    assert.equal(payload.data[0].totalCents, product.priceCents);
    assert.equal(payload.data[0].items[0].product.title, product.title);

    const serialized = JSON.stringify(payload);
    for (const privateField of [
      "buyerId",
      "sellerId",
      "supplierProductId",
      "supplierProductTitle",
      "supplierSku",
      "ownerId",
      "cloudinaryId",
      "private-storage-id",
      "payoutEligibleAt",
      "userId",
      "email",
    ]) {
      assert.equal(serialized.includes(privateField), false, `${privateField} must not be serialized`);
    }
    assert.equal(payload.data[0].items[0].product.images[0].url, "https://example.com/image.jpg");
  });
});
