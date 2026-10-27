import { before, beforeEach, after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createFakeMarketplaceStore, seedCartItem, seedCategory, seedProduct, seedSeller, type FakeMarketplaceStore } from "@/services/__tests__/fake-marketplace-store";

let store: FakeMarketplaceStore;
let user: { id: string; email: string } | null;
const initialFetch = globalThis.fetch;
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, p) => (store as unknown as Record<PropertyKey, unknown>)[p] }) } });
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => user ? { user } : null, isAdministratorRole: () => false } });
mock.module("@/lib/rate-limit", { namedExports: { rateLimit: { orderCreate: async () => ({ success: true }), paymentInitiate: async () => ({ success: true }) }, formatRetryAfter: () => "1s" } });

let orderRoute: typeof import("@/app/api/orders/route");
let estimateRoute: typeof import("@/app/api/orders/delivery-estimate/route");
let quoteRoute: typeof import("@/app/api/orders/[id]/delivery-quote/route");
let acceptRoute: typeof import("@/app/api/orders/[id]/delivery-quote/accept/route");
let paymentRoute: typeof import("@/app/api/payments/paystack/initialize/route");
let checkout: typeof import("@/modules/orders/service").checkoutCart;
const BUYER = "buyer", SELLER = "seller", OTHER = "other";
const HOST = "https://malihub.test";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(path: string, body: unknown, origin: string | null = HOST) {
  const headers = new Headers({ host: "malihub.test", "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new NextRequest(`${HOST}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function getRequest(path: string) { return new NextRequest(`${HOST}${path}`, { method: "GET", headers: { host: "malihub.test" } }); }
const delivery = { deliveryCounty: "Nairobi", deliveryAddress: "Moi Avenue", acceptedDeliveryFeeCents: 25000, acceptedSellerCount: 1 };

before(async () => {
  orderRoute = await import("@/app/api/orders/route");
  estimateRoute = await import("@/app/api/orders/delivery-estimate/route");
  quoteRoute = await import("@/app/api/orders/[id]/delivery-quote/route");
  acceptRoute = await import("@/app/api/orders/[id]/delivery-quote/accept/route");
  paymentRoute = await import("@/app/api/payments/paystack/initialize/route");
  ({ checkoutCart: checkout } = await import("@/modules/orders/service"));
});
beforeEach(() => {
  store = createFakeMarketplaceStore();
  user = { id: BUYER, email: "buyer@example.test" };
  process.env.NEXT_PUBLIC_APP_URL = HOST;
  process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":25000}';
  process.env.PAYSTACK_SECRET_KEY = "sk_test_example123";
  process.env.PAYSTACK_CALLBACK_URL = "https://malihub.test/payment-result";
  globalThis.fetch = initialFetch;
});
after(() => { globalThis.fetch = initialFetch; });

function seedCart() {
  const seller = seedSeller(store, { userId: SELLER });
  seedSeller(store, { userId: OTHER });
  const category = seedCategory(store);
  const product = seedProduct(store, { sellerId: seller.id, ownerId: SELLER, categoryId: category.id, priceCents: 100000 });
  seedCartItem(store, BUYER, product.id, 2);
}
async function placedOrder() {
  seedCart();
  return (await checkout(store as never, BUYER, { county: "Nairobi", address: "Moi Avenue", acceptedFeeCents: 25000, acceptedSellerCount: 1 })).orders[0]!;
}

describe("delivery API authentication, CSRF and validation", () => {
  it("requires same-origin and sessions for all mutating delivery and payment endpoints", async () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const endpoints = [
      () => orderRoute.POST(request("/api/orders", delivery, null)),
      () => estimateRoute.POST(request("/api/orders/delivery-estimate", { county: "Nairobi" }, null)),
      () => quoteRoute.POST(request(`/api/orders/${id}/delivery-quote`, { amountCents: 1 }, null), context(id)),
      () => acceptRoute.POST(request(`/api/orders/${id}/delivery-quote/accept`, { quoteVersion: 1, quotedFeeCents: 1 }, null), context(id)),
      () => paymentRoute.POST(request("/api/payments/paystack/initialize", { orderId: id, quoteVersion: 0 }, null)),
    ];
    for (const call of endpoints) assert.equal((await call()).status, 403);
    assert.equal((await quoteRoute.POST(request(`/api/orders/${id}/delivery-quote`, { amountCents: 1 }, "https://attacker.test"), context(id))).status, 403);
    user = null;
    assert.equal((await estimateRoute.POST(request("/api/orders/delivery-estimate", { county: "Nairobi" }))).status, 401);
    assert.equal((await orderRoute.POST(request("/api/orders", delivery))).status, 401);
    assert.equal((await quoteRoute.POST(request(`/api/orders/${id}/delivery-quote`, { amountCents: 1 }), context(id))).status, 401);
    assert.equal((await acceptRoute.POST(request(`/api/orders/${id}/delivery-quote/accept`, { quoteVersion: 1, quotedFeeCents: 1 }), context(id))).status, 401);
    assert.equal((await quoteRoute.GET(getRequest(`/api/orders/${id}/delivery-quote`), context(id))).status, 401);
    assert.equal((await paymentRoute.POST(request("/api/payments/paystack/initialize", { orderId: id, quoteVersion: 0 }))).status, 401);
  });
  it("validates JSON, county rate, accepted fee, and seller count before making orders", async () => {
    seedCart();
    assert.equal((await estimateRoute.POST(request("/api/orders/delivery-estimate", "{"))).status, 400);
    assert.equal((await estimateRoute.POST(request("/api/orders/delivery-estimate", { county: "Kiambu" }))).status, 422);
    const estimate = await estimateRoute.POST(request("/api/orders/delivery-estimate", { county: "nairobi" }));
    assert.equal((await estimate.json()).data.feeCents, 25000);
    for (const body of ["{", { ...delivery, deliveryAddress: "Street\u0000building" }, { ...delivery, acceptedDeliveryFeeCents: -1 }, { ...delivery, acceptedDeliveryFeeCents: 1.5 }, { ...delivery, totalCents: 1 }, { ...delivery, acceptedSellerCount: 0 }]) {
      assert.equal((await orderRoute.POST(request("/api/orders", body))).status, 400);
    }
    assert.equal((await orderRoute.POST(request("/api/orders", { ...delivery, acceptedDeliveryFeeCents: 1 }))).status, 409);
    assert.equal((await orderRoute.POST(request("/api/orders", { ...delivery, acceptedSellerCount: 2 }))).status, 409);
    assert.equal(store.tables.orders.size, 0);
    const created = await orderRoute.POST(request("/api/orders", delivery));
    assert.equal(created.status, 201);
    const data = await created.json();
    assert.equal(data.data.orders[0].totalCents, 225000);
  });
  it("scopes quotes to sellers/buyers and rejects invalid or forged bodies", async () => {
    const order = await placedOrder();
    const path = `/api/orders/${order.id}/delivery-quote`;
    user = { id: OTHER, email: "other@example.test" };
    assert.equal((await quoteRoute.POST(request(path, { amountCents: 40000 }), context(order.id))).status, 404);
    user = { id: SELLER, email: "seller@example.test" };
    for (const body of ["{", { amountCents: -1 }, { amountCents: "40000" }, { amountCents: 1.5 }, { amountCents: 1, note: "x".repeat(501) }, { amountCents: 1, buyerId: BUYER }]) {
      assert.equal((await quoteRoute.POST(request(path, body), context(order.id))).status, 400);
    }
    assert.equal((await quoteRoute.POST(request(path, { amountCents: 40000, note: "Courier" }), context(order.id))).status, 200);
    user = { id: OTHER, email: "other@example.test" };
    assert.equal((await quoteRoute.GET(getRequest(path), context(order.id))).status, 404);
    assert.equal((await acceptRoute.POST(request(`${path}/accept`, { quoteVersion: 1, quotedFeeCents: 40000 }), context(order.id))).status, 404);
    user = { id: BUYER, email: "buyer@example.test" };
    assert.equal((await acceptRoute.POST(request(`${path}/accept`, { quoteVersion: 1, quotedFeeCents: 0 }), context(order.id))).status, 409);
    assert.equal((await acceptRoute.POST(request(`${path}/accept`, { quoteVersion: 99, quotedFeeCents: 40000 }), context(order.id))).status, 409);
    const accepted = await acceptRoute.POST(request(`${path}/accept`, { quoteVersion: 1, quotedFeeCents: 40000 }), context(order.id));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).data.totalCents, 240000);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
  it("the buyer order API never serializes internal supplier snapshots or private order notes", async () => {
    const order = await placedOrder();
    const item = [...store.tables.orderItems.values()][0]!;
    item.supplierSku = "PRIVATE-SKU"; item.supplierProductTitle = "PRIVATE-SUPPLIER";
    (store.tables.orders.get(order.id)! as unknown as Record<string, unknown>).notes = "PRIVATE-NOTES";
    const response = await orderRoute.GET();
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /PRIVATE-SKU|PRIVATE-SUPPLIER|PRIVATE-NOTES/);
    assert.match(text, /225000/);
  });
});

describe("actual Paystack initialization boundary", () => {
  it("keeps an ambiguous provider timeout reserved and refuses a duplicate charge", async () => {
    const order = await placedOrder();
    let providerCalls = 0;
    globalThis.fetch = (async () => { providerCalls++; throw new Error("simulated network timeout"); }) as typeof fetch;
    const endpoint = "/api/payments/paystack/initialize";
    const first = await paymentRoute.POST(request(endpoint, { orderId: order.id, quoteVersion: 0 }));
    assert.equal(first.status, 503);
    assert.equal(store.tables.payments.size, 1);
    const payment = [...store.tables.payments.values()][0]!;
    assert.equal(payment.status, "PENDING");
    assert.equal((payment.metadata as { paystack: { initialization: string } }).paystack.initialization, "unknown");
    assert.equal((await paymentRoute.POST(request(endpoint, { orderId: order.id, quoteVersion: 0 }))).status, 409);
    assert.equal(providerCalls, 1);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("does not hand out an access code if the reserved payment changed during provider initialization", async () => {
    const order = await placedOrder();
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { reference: string };
      [...store.tables.payments.values()][0]!.status = "SUCCESS"; // concurrent settlement
      return Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/test", access_code: "do-not-return", reference: body.reference } });
    }) as typeof fetch;
    const response = await paymentRoute.POST(request("/api/payments/paystack/initialize", { orderId: order.id, quoteVersion: 0 }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "payment_state_changed");
    assert.equal(JSON.stringify(body).includes("do-not-return"), false);
    assert.equal([...store.tables.payments.values()][0]!.status, "SUCCESS");
  });

  it("blocks an unaccepted quote, then sends only the accepted server total and reuses the attempt", async () => {
    const order = await placedOrder();
    const path = `/api/orders/${order.id}/delivery-quote`;
    user = { id: SELLER, email: "seller@example.test" };
    await quoteRoute.POST(request(path, { amountCents: 40000 }), context(order.id));
    user = { id: BUYER, email: "buyer@example.test" };
    let providerCalls = 0;
    let providerAmount: unknown;
    let providerCallback: unknown;
    globalThis.fetch = (async (_input, init) => {
      providerCalls++;
      const body = JSON.parse(String(init?.body)) as { amount: string; reference: string; callback_url: string };
      providerAmount = body.amount;
      providerCallback = body.callback_url;
      return Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/test", access_code: "code", reference: body.reference } });
    }) as typeof fetch;
    const endpoint = "/api/payments/paystack/initialize";
    assert.equal((await paymentRoute.POST(request(endpoint, { orderId: order.id, quoteVersion: 1, amountCents: 1 }))).status, 400);
    const blocked = await paymentRoute.POST(request(endpoint, { orderId: order.id, quoteVersion: 1 }));
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, "delivery_not_accepted");
    assert.equal(providerCalls, 0);
    await acceptRoute.POST(request(`${path}/accept`, { quoteVersion: 1, quotedFeeCents: 40000 }), context(order.id));
    const first = await paymentRoute.POST(request(endpoint, { orderId: order.id, quoteVersion: 1 }));
    assert.equal(first.status, 200);
    assert.equal(providerAmount, "240000");
    assert.equal(new URL(String(providerCallback)).searchParams.get("orderId"), order.id);
    assert.equal(providerCalls, 1);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    const second = await paymentRoute.POST(request(endpoint, { orderId: order.id, quoteVersion: 1 }));
    assert.equal(second.status, 200);
    assert.equal((await second.json()).data.reused, true);
    assert.equal(providerCalls, 1);
    assert.equal(store.tables.payments.size, 1);
    user = { id: SELLER, email: "seller@example.test" };
    assert.equal((await quoteRoute.POST(request(path, { amountCents: 50000 }), context(order.id))).status, 409);
  });
});
