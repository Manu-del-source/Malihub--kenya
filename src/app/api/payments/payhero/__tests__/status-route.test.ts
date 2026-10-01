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
 * `/api/payments/payhero/status` at the route boundary.
 *
 * Same harness as the STK route suite: the whole stack runs for real (route →
 * CSRF → session → status service → REAL PayHero client), with only the HTTP
 * boundary stubbed and auth/prisma/rate-limit substituted.
 *
 * What this pins — the buyer-facing guarantees the checkout screen depends on:
 *  - ownership: another buyer's order id is a 404 with no existence oracle,
 *  - reads never touch the provider (GET), verification does (POST),
 *  - a verified SUCCESS settles payment AND order through the existing claim,
 *  - a provider outage is reported honestly and changes nothing,
 *  - the payload carries no PII, no metadata blob and no credentials.
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

let limiterTrip = false;
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: {
      paymentStatusCheck: async () =>
        limiterTrip
          ? { success: false, limit: 30, remaining: 0, reset: Date.now() + 60_000 }
          : { success: true, limit: 30, remaining: 29, reset: Date.now() + 60_000 },
    },
    formatRetryAfter: () => "30s",
  },
});

let route: typeof import("@/app/api/payments/payhero/status/route");

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";
const SELLER_1 = "seller-1";
const TOKEN = "status-test-token";

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

function providerSuccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      status: "SUCCESS",
      reference: "PH-REF-1",
      provider_reference: "MPESA-RCPT-1",
      CheckoutRequestID: "ws_CO_STATUS_1",
      ...overrides,
    },
  };
}

function request(
  { method = "GET", body, orderId, origin = "http://localhost:3000", host = "localhost:3000", rawBody }: {
    method?: "GET" | "POST";
    body?: unknown;
    orderId?: string;
    origin?: string | null;
    host?: string;
    rawBody?: string;
  } = {}
): NextRequest {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  const url =
    method === "GET"
      ? `http://localhost:3000/api/payments/payhero/status?orderId=${encodeURIComponent(orderId ?? "")}`
      : "http://localhost:3000/api/payments/payhero/status";

  if (method === "POST") {
    headers.set("content-type", "application/json");
    return new NextRequest(url, { method, headers, body: rawBody ?? JSON.stringify(body ?? {}) });
  }
  return new NextRequest(url, { method, headers });
}

function seedListing(quantity = 5, priceCents = 100_000) {
  const seller = seedSeller(store, { userId: SELLER_1, businessName: "Route Shop" });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store, "status-cat");
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
  route = await import("@/app/api/payments/payhero/status/route");
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
  process.env.PAYHERO_AUTH_TOKEN = TOKEN;
  process.env.PAYHERO_CHANNEL_ID = "133";
  process.env.PAYHERO_CALLBACK_URL = "https://malihub.example.com/api/payments/payhero/callback";

  fetchCalls = [];
  fetchScript = () => providerSuccess();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    const answer = fetchScript();
    return { ok: answer.ok, status: answer.status, json: async () => answer.body } as Response;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("GET /api/payments/payhero/status — authentication, CSRF, validation", () => {
  it("refuses an unauthenticated read and never touches PayHero", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    sessionUser = null;

    const response = await route.GET(request({ orderId: order.id }));

    assert.equal(response.status, 401);
    assert.equal(fetchCalls.length, 0);
  });

  it("is a read-only route: no Origin header needed, but no provider call either", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_STATUS_1",
    });

    const response = await route.GET(request({ orderId: order.id, origin: null }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.payment.status, "PROCESSING");
    assert.equal(body.data.verification, null);
    assert.equal(fetchCalls.length, 0, "GET must not call the provider");
  });

  it("rejects a missing or non-UUID order id with 400", async () => {
    const missing = await route.GET(request({ orderId: "" }));
    assert.equal(missing.status, 400);

    const malformed = await route.GET(request({ orderId: "not-a-uuid" }));
    assert.equal(malformed.status, 400);

    const postMalformed = await route.POST(request({ method: "POST", body: { orderId: "nope" } }));
    assert.equal(postMalformed.status, 400);
    assert.equal(fetchCalls.length, 0);
  });

  it("POST rejects a cross-origin request and a non-JSON body before any work", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const crossOrigin = await route.POST(
      request({ method: "POST", body: { orderId: order.id }, origin: "https://evil.example.com" })
    );
    assert.equal(crossOrigin.status, 403);

    const badJson = await route.POST(
      request({ method: "POST", rawBody: "{not json", orderId: order.id })
    );
    assert.equal(badJson.status, 400);
    assert.equal(fetchCalls.length, 0);
  });
});

describe("GET /api/payments/payhero/status — ownership", () => {
  it("answers 404 for another buyer's order (no oracle) on GET and POST", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    sessionUser = { id: BUYER_B, email: "buyer-b@example.com", phone: "0712345678" };

    const get = await route.GET(request({ orderId: order.id }));
    const post = await route.POST(request({ method: "POST", body: { orderId: order.id } }));

    assert.equal(get.status, 404);
    assert.equal(post.status, 404);
    assert.equal(fetchCalls.length, 0, "a foreign order must never reach the provider");
    const payload = JSON.stringify(await get.json());
    assert.equal(payload.includes(order.orderNumber), false, "no order details leak");
  });

  it("answers 404 for an order id that does not exist at all", async () => {
    const response = await route.GET(request({ orderId: crypto.randomUUID() }));
    assert.equal(response.status, 404);
  });
});

describe("POST /api/payments/payhero/status — verification settles through the existing claims", () => {
  it("verifies a PROCESSING attempt, settles payment and order, and reports it", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_STATUS_1",
    });

    const response = await route.POST(request({ method: "POST", body: { orderId: order.id } }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.payment.status, "SUCCESS");
    assert.equal(body.data.payment.providerReference, "MPESA-RCPT-1");
    assert.equal(body.data.order.status, "PAID");
    assert.equal(body.data.verification.ok, true);
    assert.equal(body.data.verification.outcome, "verified_success");

    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");

    // The lookup used the provider reference, the documented key.
    assert.match(fetchCalls[0]!.url, /transaction-status\?reference=PH-REF-1/);
    const auth = (fetchCalls[0]!.init.headers as Record<string, string>).Authorization;
    assert.equal(auth, `Basic ${TOKEN}`);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(TOKEN), false, "no credential leakage");
    assert.equal(serialized.includes("2547"), false, "no phone number in the payload");
    assert.equal(serialized.includes("metadata"), false, "no provider metadata blob");
  });

  it("reports a provider outage honestly and changes nothing", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_STATUS_1",
    });
    fetchScript = () => ({ ok: false, status: 502, body: {} });

    const response = await route.POST(request({ method: "POST", body: { orderId: order.id } }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.verification.ok, false);
    assert.equal(body.data.verification.code, "provider_unavailable");
    assert.equal(body.data.payment.status, "PROCESSING", "still waiting, not failed");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("does not call the provider for a payment that has no provider reference yet", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PENDING",
      amountCents: order.totalCents,
      providerTransactionId: null,
    });

    const response = await route.POST(request({ method: "POST", body: { orderId: order.id } }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.verification, null);
    assert.equal(fetchCalls.length, 0);
  });

  it("answers 429 with a stable code when the status-check window trips", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    limiterTrip = true;

    const response = await route.POST(request({ method: "POST", body: { orderId: order.id } }));
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "rate_limited");
    assert.equal(response.headers.get("retry-after") !== null, true);
    assert.equal(fetchCalls.length, 0);
  });
});
