import { before, beforeEach, describe, it, mock } from "node:test";
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
 * `POST /api/payments/payhero/callback` at the route boundary.
 *
 * Route shell + full callback pipeline run for real against the fake store.
 * What is pinned here (the pipeline internals have their own suite):
 *
 *  - PayHero calls this server-to-server: NO session and NO Origin header,
 *    and the route must NOT apply the browser same-origin CSRF guard — a
 *    server callback that had to look like a browser form post would be a
 *    broken integration. Deliberate, and proven below.
 *  - structurally invalid payloads are a 400; everything well-formed is a
 *    200 — including unknown references and duplicates (retry storms change
 *    nothing; the event rows say what happened).
 *  - a genuine internal failure is a generic 500 so the provider retries.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => (store as unknown as Record<string, unknown>)[property],
});

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });

let route: typeof import("@/app/api/payments/payhero/callback/route");

const BUYER_A = "buyer-a";
const SELLER_1 = "seller-1";

function request(
  body?: unknown,
  { rawBody, headers }: { rawBody?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest("http://localhost:3000/api/payments/payhero/callback", {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", ...headers }),
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

function seedListing(quantity = 5, priceCents = 100_000) {
  const seller = seedSeller(store, { userId: SELLER_1, businessName: "CbRoute Shop" });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store, "cb-route-cat");
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

function successCallback(orderNumber: string, amountKes = 2_000, checkoutRequestId = "ws_CO_ROUTE_1") {
  return {
    forward_url: "",
    status: true,
    response: {
      Amount: amountKes,
      CheckoutRequestID: checkoutRequestId,
      ExternalReference: orderNumber,
      MerchantRequestID: "3202-70921557-1",
      MpesaReceiptNumber: "SAE3YULR0Y",
      Phone: "+254712345678",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      Status: "Success",
    },
  };
}

before(async () => {
  route = await import("@/app/api/payments/payhero/callback/route");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
});

describe("POST /api/payments/payhero/callback — transport rules", () => {
  it("processes a server-to-server delivery WITHOUT any session or Origin header", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_ROUTE_1",
    });
    // Explicitly NO origin / referer / cookie headers anywhere on this request.
    const response = await route.POST(request(successCallback(order.orderNumber)));

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { success: true, data: { received: true } });

    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("answers 400 to a non-JSON body and stores nothing", async () => {
    const response = await route.POST(request(undefined, { rawBody: "<<<not json>>>" }));
    assert.equal(response.status, 400);
    assert.equal(store.tables.paymentEvents.size, 0);
  });

  it("answers 400 to a payload that is not the documented shape", async () => {
    const response = await route.POST(request({ hello: "world" }));
    assert.equal(response.status, 400);
    assert.equal(store.tables.paymentEvents.size, 0);
  });

  it("answers 200 to a well-formed callback for an unknown reference — and leaks nothing", async () => {
    const response = await route.POST(request(successCallback("MH-GHOST999", 10, "ws_CO_GHOST")));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { success: true, data: { received: true } });
    // Recorded for forensics, settled nothing.
    assert.equal(store.tables.paymentEvents.size, 1);
    assert.equal(store.tables.payments.size, 0);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("MH-GHOST999"), false, "the response echoes no references");
  });

  it("answers 200 to a duplicate redelivery", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_ROUTE_1",
    });

    const first = await route.POST(request(successCallback(order.orderNumber)));
    const second = await route.POST(request(successCallback(order.orderNumber)));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(store.tables.paymentEvents.size, 1, "one event, however many deliveries");
  });

  it("a genuine internal failure is a generic 500 (the provider may retry)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_ROUTE_1",
    });

    const realFindUnique = store.payment.findUnique;
    store.payment.findUnique = (() => {
      throw new Error("synthetic database failure");
    }) as never;
    try {
      const response = await route.POST(request(successCallback(order.orderNumber)));
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.equal(body.error, "Something went wrong.");
    } finally {
      store.payment.findUnique = realFindUnique;
    }
  });
});
