import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createFakeMarketplaceStore,
  seedCategory,
  seedProduct,
  seedSeller,
  type FakeMarketplaceStore,
} from "@/services/__tests__/fake-marketplace-store";

/**
 * `/api/cart` route-level behaviour.
 *
 * The route is a thin shell over the (unit-tested) cart service, so what
 * matters at this level is the shell itself:
 *  - no session → 401, always;
 *  - mutating methods run behind the same-origin (CSRF) guard;
 *  - identity comes from `getCurrentUser()` on the SERVER — the request body
 *    only ever carries `productId`/`quantity`;
 *  - a forged body (bad uuid, bad quantity) never reaches the service.
 *
 * `@/lib/auth` and `@/lib/prisma` are substituted at the module boundary; the
 * route handler, CSRF guard and cart service all run for real.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

type SessionUser = { id: string; email: string } | null;
let sessionUser: SessionUser = null;

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser ? { identity: { authUserId: "neon-1" }, user: sessionUser } : null,
    isAdministratorRole: () => false,
  },
});

let route: typeof import("@/app/api/cart/route");

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";

function seedActiveListing(quantity = 5, priceCents = 100_000) {
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

function request(
  method: string,
  body?: unknown,
  { origin = "http://localhost:3000", host = "localhost:3000" }: { origin?: string | null; host?: string } = {}
): NextRequest {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://localhost:3000/api/cart", {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

before(async () => {
  route = await import("@/app/api/cart/route");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  store.operations.length = 0;
  sessionUser = null;
});

describe("GET /api/cart", () => {
  it("answers 401 without a session", async () => {
    const response = await route.GET();
    assert.equal(response.status, 401);
  });

  it("returns only the signed-in buyer's cart", async () => {
    const product = seedActiveListing();
    store.tables.cartItems.set("cart-1", {
      id: "cart-1",
      userId: BUYER_A,
      productId: product.id,
      quantity: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    sessionUser = { id: BUYER_B, email: "b@example.com" };
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.data.itemCount, 0, "buyer B must not see buyer A's cart");

    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const own = await route.GET();
    const ownPayload = await own.json();
    assert.equal(ownPayload.data.itemCount, 1);
    assert.equal(ownPayload.data.subtotalCents, 200_000);
  });
});

describe("POST /api/cart", () => {
  it("rejects cross-origin mutations (CSRF)", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const product = seedActiveListing();

    const response = await route.POST(
      request("POST", { productId: product.id, quantity: 1 }, { origin: "https://evil.example" })
    );
    assert.equal(response.status, 403);
    assert.equal(store.tables.cartItems.size, 0, "no write happened");
  });

  it("rejects mutations without an Origin header", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const response = await route.POST(request("POST", {}, { origin: null }));
    assert.equal(response.status, 403);
  });

  it("answers 401 for an unauthenticated add", async () => {
    const product = seedActiveListing();
    const response = await route.POST(request("POST", { productId: product.id, quantity: 1 }));
    assert.equal(response.status, 401);
    assert.equal(store.tables.cartItems.size, 0);
  });

  it("adds a product for the session's buyer", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const product = seedActiveListing();

    const response = await route.POST(
      request("POST", { productId: product.id, quantity: 2 })
    );
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.data.itemCount, 1);

    const rows = [...store.tables.cartItems.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, BUYER_A, "owner id is derived from the session, not the body");
  });

  it("rejects an invalid quantity before it reaches the service", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const product = seedActiveListing();

    const response = await route.POST(
      request("POST", { productId: product.id, quantity: 0 })
    );
    assert.equal(response.status, 400);
    assert.equal(store.tables.cartItems.size, 0);
  });

  it("rejects a malformed productId", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const response = await route.POST(request("POST", { productId: "not-a-uuid", quantity: 1 }));
    assert.equal(response.status, 400);
  });

  it("rejects an unavailable product with the service's copy", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const product = seedActiveListing();
    product.status = "SOLD";

    const response = await route.POST(
      request("POST", { productId: product.id, quantity: 1 })
    );
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, "unavailable");
    assert.match(payload.error, /no longer available/);
  });

  it("answers 404 for a product that does not exist", async () => {
    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const response = await route.POST(
      request("POST", { productId: "11111111-2222-4333-8444-555555555555", quantity: 1 })
    );
    assert.equal(response.status, 404);
  });
});

describe("PATCH /api/cart", () => {
  it("requires a session and a same-origin request", async () => {
    const product = seedActiveListing();

    const unauthenticated = await route.PATCH(request("PATCH", { productId: product.id, quantity: 2 }));
    assert.equal(unauthenticated.status, 401);

    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const crossOrigin = await route.PATCH(
      request("PATCH", { productId: product.id, quantity: 2 }, { origin: "https://evil.example" })
    );
    assert.equal(crossOrigin.status, 403);
  });
});

describe("DELETE /api/cart", () => {
  it("removes only the session buyer's own line", async () => {
    const product = seedActiveListing();
    store.tables.cartItems.set("cart-a", {
      id: "cart-a",
      userId: BUYER_A,
      productId: product.id,
      quantity: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    sessionUser = { id: BUYER_B, email: "b@example.com" };
    const foreign = await route.DELETE(
      request("DELETE", { productId: product.id })
    );
    assert.equal(foreign.status, 200);
    assert.equal(store.tables.cartItems.size, 1, "buyer B's delete cannot touch buyer A's row");

    sessionUser = { id: BUYER_A, email: "a@example.com" };
    const own = await route.DELETE(request("DELETE", { productId: product.id }));
    assert.equal(own.status, 200);
    assert.equal(store.tables.cartItems.size, 0);
  });
});
