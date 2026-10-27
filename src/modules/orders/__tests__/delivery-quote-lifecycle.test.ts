import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakeMarketplaceStore, seedCartItem, seedCategory, seedPayment, seedProduct, seedSeller, type FakeMarketplaceStore } from "@/services/__tests__/fake-marketplace-store";

let store: FakeMarketplaceStore;
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, p) => (store as unknown as Record<PropertyKey, unknown>)[p] }) } });
let orders: typeof import("@/modules/orders/service");
let quotes: typeof import("@/modules/orders/delivery-quote-service");
let payments: typeof import("@/services/payment-initialization-service");
let transitions: typeof import("@/services/order-transition-service");
const BUYER = "buyer", OTHER = "other", SELLER = "seller", INTRUDER = "intruder";
const delivery = { county: "Nairobi", address: "Moi Avenue", acceptedFeeCents: 25000, acceptedSellerCount: 1 };

before(async () => {
  orders = await import("@/modules/orders/service");
  quotes = await import("@/modules/orders/delivery-quote-service");
  payments = await import("@/services/payment-initialization-service");
  transitions = await import("@/services/order-transition-service");
});
beforeEach(() => { store = createFakeMarketplaceStore(); process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":25000}'; });

async function fixture() {
  const seller = seedSeller(store, { userId: SELLER });
  seedSeller(store, { userId: INTRUDER });
  const category = seedCategory(store);
  const product = seedProduct(store, { sellerId: seller.id, ownerId: SELLER, categoryId: category.id, priceCents: 100000 });
  seedCartItem(store, BUYER, product.id, 2);
  const created = await orders.checkoutCart(store as never, BUYER, delivery);
  return created.orders[0]!;
}
const quote = (orderId: string, amountCents = 40000, note = "Courier delivery") =>
  quotes.submitDeliveryQuote(store as never, { userId: SELLER, orderId, amountCents, note });
const accept = (orderId: string, quoteVersion = 1, quotedFeeCents = 40000) =>
  quotes.acceptDeliveryQuote(store as never, { userId: BUYER, orderId, quoteVersion, quotedFeeCents });
const reserve = (orderId: string, userId = BUYER, quoteVersion = store.tables.orders.get(orderId)?.deliveryQuoteVersion ?? 0) =>
  payments.reservePaystackPayment(store as never, { userId, orderId, quoteVersion });

describe("delivery quote lifecycle and payment safety", () => {
  it("snapshots an accepted estimate per order and reserves exactly the server total", async () => {
    const order = await fixture();
    assert.equal(order.subtotalCents, 200000);
    assert.equal(order.deliveryFeeCents, 25000);
    assert.equal(order.totalCents, 225000);
    const row = store.tables.orders.get(order.id)!;
    assert.equal(row.deliveryEstimateCents, 25000);
    assert.ok(row.deliveryFeeAcceptedAt);
    const result = await reserve(order.id);
    assert.equal(result.kind, "reserved");
    if (result.kind === "reserved") assert.equal(result.amountCents, 225000);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
  it("enforces seller ownership, non-negative integer prices and buyer-visible note limits", async () => {
    const order = await fixture();
    for (const userId of [INTRUDER, OTHER]) {
      await assert.rejects(() => quotes.submitDeliveryQuote(store as never, { userId, orderId: order.id, amountCents: 1 }), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "not_found");
    }
    for (const amountCents of [-1, 1.2, 2147483648, NaN]) {
      await assert.rejects(() => quote(order.id, amountCents), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "invalid");
    }
    await assert.rejects(() => quote(order.id, 1, "x".repeat(501)), quotes.DeliveryQuoteError);
    assert.equal(store.tables.orders.get(order.id)!.deliveryQuoteCents, null);
  });
  it("blocks payment on a new quote until the owner accepts its exact version and amount", async () => {
    const order = await fixture();
    await quote(order.id);
    let row = store.tables.orders.get(order.id)!;
    assert.equal(row.deliveryFeeStatus, "QUOTED");
    assert.equal(row.deliveryFeeAcceptedAt, null);
    assert.equal(row.deliveryQuoteVersion, 1);
    assert.equal(row.deliveryFeeCents, 25000, "previous estimate stays as the accepted total until review");
    assert.equal(row.totalCents, 225000);
    await assert.rejects(() => reserve(order.id), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "delivery_not_accepted");
    await assert.rejects(() => quotes.acceptDeliveryQuote(store as never, { userId: OTHER, orderId: order.id, quoteVersion: 1, quotedFeeCents: 40000 }), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "not_found");
    await assert.rejects(() => accept(order.id, 1, 1), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "stale_quote");
    await assert.rejects(() => accept(order.id, 2, 40000), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "stale_quote");
    const accepted = await accept(order.id);
    assert.equal(accepted.feeStatus, "CONFIRMED");
    assert.equal(accepted.feeCents, 40000);
    assert.equal(accepted.totalCents, 240000);
    row = store.tables.orders.get(order.id)!;
    assert.equal(row.status, "PENDING", "acceptance never records payment");
    assert.ok(row.deliveryFeeAcceptedAt);
    assert.equal((await accept(order.id)).totalCents, 240000, "replayed acceptance is harmless");
    const result = await reserve(order.id);
    assert.equal(result.kind, "reserved");
    if (result.kind === "reserved") assert.equal(result.amountCents, 240000);
  });
  it("a changed amount or note invalidates prior acceptance and stale versions; identical retries do not", async () => {
    const order = await fixture();
    await quote(order.id);
    await accept(order.id);
    const same = await quote(order.id);
    assert.equal(same.changed, false);
    assert.equal(store.tables.orders.get(order.id)!.deliveryFeeStatus, "CONFIRMED");
    await quote(order.id, 45000, "New route");
    const row = store.tables.orders.get(order.id)!;
    assert.equal(row.deliveryQuoteVersion, 2);
    assert.equal(row.deliveryFeeStatus, "QUOTED");
    assert.equal(row.deliveryFeeAcceptedAt, null);
    await assert.rejects(() => accept(order.id), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "stale_quote");
    await assert.rejects(() => reserve(order.id), payments.PaymentInitializationError);
    assert.equal((await accept(order.id, 2, 45000)).totalCents, 245000);
    await assert.rejects(() => reserve(order.id, BUYER, 1), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "delivery_changed");
  });
  it("refuses price changes after payment starts, after a failure, or after paid/cancelled status", async () => {
    const order = await fixture();
    await reserve(order.id);
    await assert.rejects(() => quote(order.id), (e: unknown) => e instanceof quotes.DeliveryQuoteError && e.code === "conflict");
    const payment = [...store.tables.payments.values()][0]!;
    payment.status = "FAILED";
    await assert.rejects(() => quote(order.id), quotes.DeliveryQuoteError);
    store.tables.orders.get(order.id)!.status = "PAID";
    await assert.rejects(() => quote(order.id), quotes.DeliveryQuoteError);
    store.tables.orders.get(order.id)!.status = "CANCELLED";
    await assert.rejects(() => quote(order.id), quotes.DeliveryQuoteError);
  });
  it("reissues an identical unversioned legacy quote so the buyer can accept it", async () => {
    const order = await fixture();
    const row = store.tables.orders.get(order.id)!;
    row.deliveryEstimateCents = null;
    row.deliveryFeeAcceptedAt = null;
    row.deliveryFeeStatus = "QUOTED";
    row.deliveryQuoteCents = 40000;
    row.deliveryQuoteNote = "Courier delivery";
    row.deliveryQuoteUpdatedAt = new Date();
    row.deliveryQuoteVersion = 0;
    assert.equal((await quote(order.id)).changed, true);
    assert.equal(store.tables.orders.get(order.id)!.deliveryQuoteVersion, 1);
    const accepted = await accept(order.id);
    assert.equal(accepted.totalCents, 240000);
    assert.equal(accepted.feeStatus, "CONFIRMED");
  });
  it("holds cancellation and a second provider reference after a terminal attempt for support review", async () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      store = createFakeMarketplaceStore();
      const order = await fixture();
      await reserve(order.id);
      [...store.tables.payments.values()][0]!.status = status;
      const item = [...store.tables.orderItems.values()][0]!;
      const stock = store.tables.products.get(item.productId)!.quantity;
      await assert.rejects(() => reserve(order.id), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "payment_requires_review");
      await assert.rejects(() => transitions.cancelOrder(store as never, { actorUserId: BUYER, orderId: order.id }), transitions.OrderTransitionError);
      assert.equal(store.tables.payments.size, 1);
      assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
      assert.equal(store.tables.products.get(item.productId)!.quantity, stock);
    }
  });
  it("fails closed for an unaccepted legacy order, inconsistent totals, bad items and other buyers", async () => {
    const order = await fixture();
    await assert.rejects(() => reserve(order.id, OTHER), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "not_found");
    const row = store.tables.orders.get(order.id)!;
    const acceptedAt = row.deliveryFeeAcceptedAt;
    row.deliveryFeeAcceptedAt = null;
    await assert.rejects(() => reserve(order.id), payments.PaymentInitializationError);
    row.deliveryFeeAcceptedAt = acceptedAt;
    row.totalCents += 1;
    await assert.rejects(() => reserve(order.id), payments.PaymentInitializationError);
    row.totalCents -= 1;
    const item = [...store.tables.orderItems.values()][0]!;
    item.totalCents += 1;
    await assert.rejects(() => reserve(order.id), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "invalid_amount");
    assert.equal(store.tables.payments.size, 0);
  });
  it("refuses an existing in-flight attempt with a stale amount", async () => {
    const order = await fixture();
    seedPayment(store, { orderId: order.id, customerReference: "MH-old", amountCents: 1, status: "PROCESSING", metadata: { paystack: { accessCode: "old" } } });
    await assert.rejects(() => reserve(order.id), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "payment_initializing");
    assert.equal(store.tables.payments.size, 1);
  });
  it("refuses to resume an active checkout when older attempts may also be payable", async () => {
    const order = await fixture();
    seedPayment(store, { orderId: order.id, customerReference: "MH-older", amountCents: order.totalCents, status: "FAILED" });
    seedPayment(store, { orderId: order.id, customerReference: "MH-active", amountCents: order.totalCents, status: "PROCESSING", metadata: { paystack: { accessCode: "active-code" } } });
    await assert.rejects(() => reserve(order.id), (e: unknown) => e instanceof payments.PaymentInitializationError && e.code === "payment_requires_review");
    assert.equal(store.tables.payments.size, 2);
  });
  it("serializes duplicate payment requests and reuses the existing provider access code", async () => {
    const order = await fixture();
    const results = await Promise.allSettled([reserve(order.id), reserve(order.id)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(store.tables.payments.size, 1);
    const payment = [...store.tables.payments.values()][0]!;
    payment.status = "PROCESSING";
    payment.metadata = { paystack: { accessCode: "provider-code" } };
    const reused = await reserve(order.id);
    assert.equal(reused.kind, "reused");
    if (reused.kind === "reused") assert.equal(reused.accessCode, "provider-code");
    assert.equal(store.tables.payments.size, 1);
  });
  it("serializes a quote against a simultaneous payment reservation", async () => {
    const order = await fixture();
    const results = await Promise.allSettled([quote(order.id), reserve(order.id)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const row = store.tables.orders.get(order.id)!;
    if (row.deliveryFeeStatus === "QUOTED") assert.equal(store.tables.payments.size, 0);
    else {
      assert.equal(store.tables.payments.size, 1);
      assert.equal([...store.tables.payments.values()][0]!.amountCents, row.totalCents);
    }
  });
  it("serializes cancellation against payment reservation in either order without losing stock", async () => {
    for (const cancelFirst of [true, false]) {
      store = createFakeMarketplaceStore();
      const order = await fixture();
      const item = [...store.tables.orderItems.values()][0]!;
      const reservedStock = store.tables.products.get(item.productId)!.quantity;
      const cancel = () => transitions.cancelOrder(store as never, { actorUserId: BUYER, orderId: order.id });
      const pay = () => reserve(order.id);
      const outcomes = await Promise.allSettled(cancelFirst ? [cancel(), pay()] : [pay(), cancel()]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      const row = store.tables.orders.get(order.id)!;
      if (cancelFirst) {
        assert.equal(row.status, "CANCELLED");
        assert.equal(store.tables.payments.size, 0);
        assert.equal(store.tables.products.get(item.productId)!.quantity, reservedStock + item.quantity);
      } else {
        assert.equal(row.status, "PENDING");
        assert.equal(store.tables.payments.size, 1);
        assert.equal(store.tables.products.get(item.productId)!.quantity, reservedStock);
      }
    }
  });
  it("cannot keep stale consent when a new quote races buyer acceptance", async () => {
    for (const quoteFirst of [true, false]) {
      store = createFakeMarketplaceStore();
      const order = await fixture();
      await quote(order.id);
      const revise = () => quote(order.id, 45000, "Changed delivery");
      const approve = () => accept(order.id);
      await Promise.allSettled(quoteFirst ? [revise(), approve()] : [approve(), revise()]);
      const row = store.tables.orders.get(order.id)!;
      assert.equal(row.deliveryQuoteVersion, 2);
      assert.equal(row.deliveryFeeStatus, "QUOTED");
      assert.equal(row.deliveryFeeAcceptedAt, null);
      assert.equal(store.tables.payments.size, 0);
      await assert.rejects(() => reserve(order.id), payments.PaymentInitializationError);
    }
  });
  it("returns a buyer-safe projection only to the owner", async () => {
    const order = await fixture();
    await quote(order.id);
    assert.equal(await quotes.readBuyerDeliveryQuote(store as never, OTHER, order.id), null);
    const projection = await quotes.readBuyerDeliveryQuote(store as never, BUYER, order.id);
    assert.ok(projection);
    assert.equal(projection.quoteCents, 40000);
    assert.equal("buyerId" in projection, false);
    assert.equal("sellerId" in projection, false);
    assert.equal("notes" in projection, false);
  });
});
