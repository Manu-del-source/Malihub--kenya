import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createFakeMarketplaceStore,
  seedCartItem,
  seedCategory,
  seedPayment,
  seedProduct,
  seedProfile,
  seedSeller,
  seedUser,
  type FakeMarketplaceStore,
} from "@/services/__tests__/fake-marketplace-store";

/**
 * `POST /api/payments/payhero/stk` at the route boundary.
 *
 * The whole stack runs for real — route → CSRF → session → service → REAL
 * PayHero client — with only the HTTP boundary stubbed (`globalThis.fetch`)
 * and the auth/prisma modules substituted, exactly like the cancel-route
 * suite. Config comes from test PAYHERO_* env vars, so the suite also pins
 * "channel and callback URL come from server config, never the request".
 *
 * No real PayHero token exists anywhere in this file.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

type SessionUser = { id: string; email: string; phone: string | null } | null;
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

// The sliding-window limiter is fail-open when Redis is absent; this mock
// makes the window controllable so route behavior under a trip is testable.
let limiterTrip = false;
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: {
      paymentInitiate: async () =>
        limiterTrip
          ? { success: false, limit: 10, remaining: 0, reset: Date.now() + 300_000 }
          : { success: true, limit: 10, remaining: 9, reset: Date.now() + 300_000 },
    },
    formatRetryAfter: () => "in a few minutes",
  },
});

let route: typeof import("@/app/api/payments/payhero/stk/route");
let paymentService: typeof import("@/services/payment-service");

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";
const SELLER_1 = "seller-1";

const ENV_KEYS = [
  "PAYHERO_API_URL",
  "PAYHERO_AUTH_TOKEN",
  "PAYHERO_CHANNEL_ID",
  "PAYHERO_CALLBACK_URL",
] as const;

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[];
let fetchScript: () => { ok: boolean; status: number; body: unknown };
const realFetch = globalThis.fetch;

function payheroSuccess(body: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      status: "QUEUED",
      reference: "PHREF-RT",
      CheckoutRequestID: "ws_CO_ROUTE_1",
      ...body,
    },
  };
}

function request(
  body?: unknown,
  { origin = "http://localhost:3000", host = "localhost:3000", rawBody }: {
    origin?: string | null;
    host?: string;
    rawBody?: string;
  } = {}
): NextRequest {
  const headers = new Headers({ host, "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://localhost:3000/api/payments/payhero/stk", {
    method: "POST",
    headers,
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

function seedListing(quantity = 5, priceCents = 100_000) {
  const seller = seedSeller(store, { userId: SELLER_1, businessName: "Route Shop" });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store, "route-cat");
  return seedProduct(store, {
    sellerId: seller.id,
    ownerId: SELLER_1,
    categoryId: category.id,
    quantity,
    priceCents,
    status: "ACTIVE",
  });
}

async function placeOrder(buyerId: string, productId: string, quantity = 2) {
  seedCartItem(store, buyerId, productId, quantity);
  const { checkoutCart } = await import("@/services/order-service");
  const result = await checkoutCart(store as never, buyerId);
  return result.orders[0]!;
}

before(async () => {
  route = await import("@/app/api/payments/payhero/stk/route");
  paymentService = await import("@/services/payment-service");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  limiterTrip = false;
  sessionUser = { id: BUYER_A, email: "buyer-a@example.com", phone: "0712345678" };
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedProfile(store, BUYER_B, "Grace Atieno");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
  seedUser(store, { id: BUYER_B, email: "buyer-b@example.com" });

  process.env.PAYHERO_API_URL = "https://backend.payhero.co.ke/api/v2";
  process.env.PAYHERO_AUTH_TOKEN = "route-test-token";
  process.env.PAYHERO_CHANNEL_ID = "133";
  process.env.PAYHERO_CALLBACK_URL = "https://malihub.example.com/api/payments/payhero/callback";

  fetchCalls = [];
  fetchScript = () => payheroSuccess();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    const answer = fetchScript();
    return {
      ok: answer.ok,
      status: answer.status,
      json: async () => answer.body,
    } as Response;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/payments/payhero/stk — authentication, CSRF, validation", () => {
  it("refuses an unauthenticated request with 401 and never calls PayHero", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    sessionUser = null;

    const response = await route.POST(request({ orderId: order.id }));

    assert.equal(response.status, 401);
    assert.equal(fetchCalls.length, 0);
    assert.equal(store.tables.payments.size, 0);
  });

  it("rejects a cross-origin request before any payment work", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const response = await route.POST(request({ orderId: order.id }, { origin: "https://evil.example.com" }));

    assert.equal(response.status, 403);
    assert.equal(fetchCalls.length, 0);
    assert.equal(store.tables.payments.size, 0);
  });

  it("rejects a request with no Origin header", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const response = await route.POST(request({ orderId: order.id }, { origin: null }));

    assert.equal(response.status, 403);
    assert.equal(fetchCalls.length, 0);
  });

  it("rejects a non-JSON body and a non-UUID order id with 400", async () => {
    const bad1 = await route.POST(request(undefined, { rawBody: "{not json" }));
    assert.equal(bad1.status, 400);

    const bad2 = await route.POST(request({ orderId: "not-a-uuid" }));
    assert.equal(bad2.status, 400);

    const bad3 = await route.POST(request({ orderId: crypto.randomUUID(), phoneNumber: "00" }));
    assert.equal(bad3.status, 400);
    assert.equal(fetchCalls.length, 0);
  });
});

describe("POST /api/payments/payhero/stk — authorization and trust", () => {
  it("a buyer cannot initiate payment for another buyer's order (404, no oracle)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    sessionUser = { id: BUYER_B, email: "buyer-b@example.com", phone: "0712345678" };

    const response = await route.POST(request({ orderId: order.id }));

    assert.equal(response.status, 404);
    assert.equal(fetchCalls.length, 0);
    assert.equal(store.tables.payments.size, 0);
  });

  it("the client cannot override the amount — the order total is authoritative", async () => {
    const product = seedListing(5, 100_000); // KES 1000/unit
    const order = await placeOrder(BUYER_A, product.id, 2); // KES 2000

    const response = await route.POST(request({ orderId: order.id, amount: 1, totalCents: 100 }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.amountCents, 200_000, "charged amount is the order total, in cents");

    const providerBody = JSON.parse(String(fetchCalls[0]!.init.body));
    assert.equal(providerBody.amount, 2_000, "PayHero is asked for the order total in whole KES");
    assert.equal(store.tables.payments.size, 1);
  });

  it("the client cannot choose the channel, provider, or callback URL", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const response = await route.POST(
      request({
        orderId: order.id,
        channel_id: 999999,
        provider: "not-m-pesa",
        callback_url: "https://attacker.example.com/hook",
      })
    );

    assert.equal(response.status, 200);
    const providerBody = JSON.parse(String(fetchCalls[0]!.init.body));
    assert.equal(providerBody.channel_id, 133, "channel from server config");
    assert.equal(providerBody.provider, "m-pesa", "rail fixed to m-pesa");
    assert.equal(
      providerBody.callback_url,
      "https://malihub.example.com/api/payments/payhero/callback",
      "callback URL from server config"
    );
    const auth = (fetchCalls[0]!.init.headers as Record<string, string>).Authorization;
    assert.equal(auth, "Basic route-test-token", "Basic auth from server config");
  });

  it("a cancelled order is a 409 and never reaches PayHero", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const transitions = await import("@/services/order-transition-service");
    await transitions.cancelOrder(store as never, { actorUserId: BUYER_A, orderId: order.id });

    const response = await route.POST(request({ orderId: order.id }));

    assert.equal(response.status, 409);
    assert.equal(fetchCalls.length, 0);
  });
});

describe("POST /api/payments/payhero/stk — outcome mapping", () => {
  it("success answers QUEUED-with-payment-pending, never 'paid'", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const response = await route.POST(request({ orderId: order.id }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.providerStatus, "QUEUED");
    assert.equal(body.data.paymentStatus, "PROCESSING");
    assert.equal(body.data.paymentReference, order.orderNumber);
    assert.equal(body.data.checkoutRequestId, "ws_CO_ROUTE_1");
    assert.equal(body.data.alreadyInitiated, false);

    // The critical guarantee: nothing about this response says the money arrived.
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    const payment = [...store.tables.payments.values()][0]!;
    assert.equal(payment.status, "PROCESSING");
    assert.equal(payment.paidAt, null);
  });

  it("a second submit returns the existing attempt without a new provider call", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    await route.POST(request({ orderId: order.id }));
    const second = await route.POST(request({ orderId: order.id }));
    const body = await second.json();

    assert.equal(second.status, 200);
    assert.equal(body.data.alreadyInitiated, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(store.tables.payments.size, 1);
  });

  it("a PayHero server error is a 503 with a resumable attempt left behind", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    fetchScript = () => ({ ok: false, status: 502, body: {} });

    const response = await route.POST(request({ orderId: order.id }));
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, "provider_unavailable");
    assert.equal(JSON.stringify(body).includes("route-test-token"), false, "no token leakage");

    const payment = [...store.tables.payments.values()][0]!;
    assert.equal(payment.status, "PENDING", "attempt remains resumable");
    assert.equal(payment.providerTransactionId, null);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("an unexpected internal failure is a generic 500 without internals", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    // Corrupt the store to force a non-service error at the boundary.
    const poisoned = () => {
      throw new Error("synthetic infrastructure failure");
    };
    const realDelegate = store.order.findFirst;
    store.order.findFirst = poisoned as never;

    try {
      const response = await route.POST(request({ orderId: order.id }));
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.equal(body.error, "Something went wrong.");
      assert.equal(JSON.stringify(body).includes("synthetic"), false);
    } finally {
      store.order.findFirst = realDelegate;
    }
  });
});

describe("POST /api/payments/payhero/stk — abuse controls (Phase 9.3)", () => {
  it("answers 429 with a stable code when the order's attempts are exhausted", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    for (let i = 0; i < paymentService.MAX_PAYMENT_ATTEMPTS_PER_ORDER; i += 1) {
      seedPayment(store, {
        orderId: order.id,
        customerReference: i === 0 ? order.orderNumber : `${order.orderNumber}-R${i + 1}`,
        status: i % 2 === 0 ? "FAILED" : "CANCELLED",
        amountCents: order.totalCents,
        providerTransactionId: `ws_CO_SPENT_${i}`,
        retryCount: i,
      });
    }

    const response = await route.POST(request({ orderId: order.id }));
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "attempt_limit");
    assert.equal(fetchCalls.length, 0, "no push goes out when attempts are spent");
  });

  it("answers 429 when the per-buyer sliding window trips (cross-order spam control)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    limiterTrip = true;

    const response = await route.POST(request({ orderId: order.id }));
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "rate_limited");
    assert.equal(response.headers.get("retry-after") !== null, true);
    assert.equal(fetchCalls.length, 0);
    assert.equal(store.tables.payments.size, 0, "nothing is reserved");
  });
});

// Env cleanup runs in afterEach.
afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});
