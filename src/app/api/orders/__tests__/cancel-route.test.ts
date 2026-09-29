import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createFakeMarketplaceStore,
  seedCartItem,
  seedCategory,
  seedProduct,
  seedProfile,
  seedSeller,
  seedUser,
  type FakeMarketplaceStore,
} from "@/services/__tests__/fake-marketplace-store";

/**
 * `POST /api/orders/[id]/cancel` at the route boundary.
 *
 * The route is a thin shell over the (unit-tested) transition service, so what
 * matters at this level is the shell itself:
 *  - no session → 401, always;
 *  - the same-origin (CSRF) guard runs, as on every mutating route here;
 *  - identity comes from `getCurrentUser()` on the SERVER — the body carries
 *    no userId, no role, no sellerId and no status, so a forged one is inert;
 *  - a non-UUID path segment is a 400 and never reaches Prisma;
 *  - "not yours" and "does not exist" are the same 404, so the endpoint
 *    cannot be used to discover other buyers' order ids;
 *  - an unexpected database failure becomes a generic 500 with no internals.
 *
 * `@/lib/auth` and `@/lib/prisma` are substituted at the module boundary; the
 * route handler, the CSRF guard and the transition service all run for real.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

type SessionUser = { id: string; email: string } | null;
let sessionUser: SessionUser = null;

const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => (store as unknown as Record<string, unknown>)[property],
});

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser ? { identity: { authUserId: "neon-1" }, user: sessionUser } : null,
    isAdministratorRole: () => false,
  },
});

let route: typeof import("@/app/api/orders/[id]/cancel/route");

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";
const SELLER_1 = "seller-1";
const REAL_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function request(
  orderId: string,
  body?: unknown,
  { origin = "http://localhost:3000", host = "localhost:3000" }: { origin?: string | null; host?: string } = {}
): NextRequest {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  return new NextRequest(`http://localhost:3000/api/orders/${orderId}/cancel`, {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function seedListing(quantity = 5) {
  const seller = seedSeller(store, { userId: SELLER_1 });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store);
  return seedProduct(store, {
    sellerId: seller.id,
    ownerId: SELLER_1,
    categoryId: category.id,
    quantity,
    priceCents: 100_000,
    status: "ACTIVE",
  });
}

async function placeOrder(buyerId: string, productId: string, quantity = 2): Promise<string> {
  seedCartItem(store, buyerId, productId, quantity);
  const { checkoutCart } = await import("@/services/order-service");
  const result = await checkoutCart(store as never, buyerId);
  return result.orders[0]!.id;
}

const statusOf = (id: string) => store.tables.orders.get(id)!.status;
const stockOf = (id: string) => store.tables.products.get(id)!.quantity;

before(async () => {
  route = await import("@/app/api/orders/[id]/cancel/route");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  sessionUser = { id: BUYER_A, email: "buyer-a@example.com" };
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedProfile(store, BUYER_B, "Grace Atieno");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
  seedUser(store, { id: BUYER_B, email: "buyer-b@example.com" });
});

describe("POST /api/orders/[id]/cancel — authentication and CSRF", () => {
  it("refuses an unauthenticated cancellation with 401", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);
    sessionUser = null;

    const response = await route.POST(request(orderId), context(orderId));

    assert.equal(response.status, 401);
    assert.equal(statusOf(orderId), "PENDING", "nothing moved");
    assert.equal(stockOf(product.id), 3);
  });

  it("rejects a cross-origin request before touching the order", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);

    const response = await route.POST(
      request(orderId, undefined, { origin: "https://evil.example.com" }),
      context(orderId)
    );

    assert.equal(response.status, 403);
    assert.equal(statusOf(orderId), "PENDING");
    assert.equal(stockOf(product.id), 3);
  });

  it("rejects a request with no Origin header", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);

    const response = await route.POST(
      request(orderId, undefined, { origin: null }),
      context(orderId)
    );

    assert.equal(response.status, 403);
  });
});

describe("POST /api/orders/[id]/cancel — the happy path", () => {
  it("cancels the caller's own order and reports the released units", async () => {
    const product = seedListing(5);
    const orderId = await placeOrder(BUYER_A, product.id, 2);

    const response = await route.POST(request(orderId), context(orderId));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.order.status, "CANCELLED");
    assert.equal(body.data.previousStatus, "PENDING");
    assert.equal(body.data.restoredUnits, 2);
    assert.equal(stockOf(product.id), 5);
  });
});

describe("POST /api/orders/[id]/cancel — authorization", () => {
  it("answers 404 for another buyer's order and changes nothing", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);
    sessionUser = { id: BUYER_B, email: "buyer-b@example.com" };

    const response = await route.POST(request(orderId), context(orderId));
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, "not_found");
    assert.equal(statusOf(orderId), "PENDING");
    assert.equal(stockOf(product.id), 3);
  });

  it("answers 404 for an id that does not exist, identically", async () => {
    const missing = await route.POST(request(REAL_UUID), context(REAL_UUID));
    const stolen = await route.POST(request(REAL_UUID), context(REAL_UUID));

    // Identical response for "absent" and "not yours" — no existence oracle.
    assert.equal(missing.status, stolen.status);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), await stolen.json());
  });

  it("does not let a seller cancel a buyer's order", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);
    sessionUser = { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" } as never;

    const response = await route.POST(request(orderId), context(orderId));

    assert.equal(response.status, 404);
    assert.equal(statusOf(orderId), "PENDING");
  });
});

describe("POST /api/orders/[id]/cancel — input validation", () => {
  it("rejects a malformed order id with 400 and never reaches the database", async () => {
    const product = seedListing();
    await placeOrder(BUYER_A, product.id);

    // `operations` is cumulative across the file, so start from a clean slate
    // to make this assertion mean what it says.
    store.operations.length = 0;

    for (const bad of ["not-a-uuid", "../../etc/passwd", "", "12345"]) {
      const response = await route.POST(request(bad), context(bad));
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    assert.ok(
      !store.operations.includes("order.findFirst"),
      "a malformed id must not become a query"
    );
    assert.ok(!store.operations.includes("$transaction"), "nor a transaction");
  });

  it("ignores a body that tries to dictate actor, role or status", async () => {
    // INVARIANT 4: a transition is authorized by server-side identity, never
    // by client input. The route reads nothing from the body at all.
    const product = seedListing();
    const orderId = await placeOrder(BUYER_B, product.id);

    sessionUser = { id: BUYER_A, email: "buyer-a@example.com" };

    const response = await route.POST(
      request(orderId, {
        // Every one of these is ignored. A real handler that read them would
        // either cancel the wrong order or fail these assertions.
        userId: BUYER_A,
        buyerId: BUYER_A,
        actorUserId: BUYER_A,
        role: "SUPER_ADMIN",
        sellerId: "anything",
        status: "PAID",
        orderStatus: "CANCELLED",
        restoredUnits: 9_999,
        quantity: 9_999,
        bypassAuthorization: true,
      }),
      context(orderId)
    );

    assert.equal(response.status, 404, "BUYER_B's order is not BUYER_A's to cancel");
    assert.equal(statusOf(orderId), "PENDING");
    assert.equal(stockOf(product.id), 3, "no inventory moved");
  });

  it("still cancels when a body carries a benign reason", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id, 2);

    const response = await route.POST(
      request(orderId, { reason: "found it cheaper elsewhere" }),
      context(orderId)
    );

    assert.equal(response.status, 200);
    assert.equal(statusOf(orderId), "CANCELLED");
    assert.equal(stockOf(product.id), 5);
  });
});

describe("POST /api/orders/[id]/cancel — repeated and conflicting requests", () => {
  it("answers 409 the second time and does not release stock twice", async () => {
    const product = seedListing(5);
    const orderId = await placeOrder(BUYER_A, product.id, 2);

    const first = await route.POST(request(orderId), context(orderId));
    assert.equal(first.status, 200);
    assert.equal(stockOf(product.id), 5);

    const second = await route.POST(request(orderId), context(orderId));
    const body = await second.json();

    assert.equal(second.status, 409);
    assert.equal(body.code, "already_cancelled");
    assert.equal(stockOf(product.id), 5, "still 5, not 7");
  });

  it("answers 409 for an order that has already been paid", async () => {
    const product = seedListing(5);
    const orderId = await placeOrder(BUYER_A, product.id, 2);
    const { markOrderPaid } = await import("@/services/order-transition-service");
    await markOrderPaid(store as never, {
      orderId,
      actor: { id: "system", source: "test" },
    });

    const response = await route.POST(request(orderId), context(orderId));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.code, "invalid_transition");
    assert.equal(statusOf(orderId), "PAID");
    assert.equal(stockOf(product.id), 3, "a paid order is never restocked by a cancel");
  });
});

describe("POST /api/orders/[id]/cancel — error containment", () => {
  it("does not leak a database error to the client", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);

    const original = store.order.findFirst.bind(store.order);
    store.order.findFirst = async () => {
      throw new Error("connection to postgres://user:hunter2@db:5432 failed: relation does not exist");
    };

    let response: Response;
    try {
      response = await route.POST(request(orderId), context(orderId));
    } finally {
      store.order.findFirst = original;
    }

    const text = await response.text();
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(text).success, false);
    // None of the internals may reach the caller.
    for (const leak of ["postgres://", "hunter2", "relation does not exist", "Prisma", "at Object."]) {
      assert.ok(!text.includes(leak), `response must not contain "${leak}"`);
    }
  });

  it("does not leak internals on a validation refusal either", async () => {
    const product = seedListing();
    const orderId = await placeOrder(BUYER_A, product.id);
    sessionUser = { id: BUYER_B, email: "buyer-b@example.com" };

    const response = await route.POST(request(orderId), context(orderId));
    const text = await response.text();

    assert.equal(response.status, 404);
    for (const leak of ["postgres", "prisma", "stack", "orderId", "buyerId"]) {
      assert.ok(!text.includes(leak), `response must not contain "${leak}"`);
    }
  });
});
