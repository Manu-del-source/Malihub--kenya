import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Explicit zero-rate fixture; no production/default delivery price is implied.
process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":0}';
const TEST_DELIVERY = { county: "Nairobi", address: "Moi Avenue", acceptedFeeCents: 0, acceptedSellerCount: 1 };
import { createHmac } from "node:crypto";

mock.module("server-only", { namedExports: {} });

/**
 * `handlePaystackWebhook` — the only code that turns a Paystack callback into
 * financial state. The suite is organised around the four trust gates in the
 * service docstring (signature → identity → amount/currency → provider
 * re-verification) plus the delivery guarantees (dedup, replay recovery,
 * superseded siblings) that Paystack's retry policy makes mandatory.
 *
 * Every scenario in this file is one the production pipeline must survive:
 * forged signatures, tampered bodies, unknown references, wrong amounts in
 * BOTH directions, non-corroborating provider answers, and redeliveries.
 */

let store: FakeMarketplaceStore;
const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => (store as unknown as Record<string, unknown>)[property],
});
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });

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
} from "./fake-marketplace-store";

let service: typeof import("@/services/payment-webhook-service");
let PaystackClientErrorCtor: typeof import("@/lib/payments/paystack").PaystackClientError;
type PaystackClientType = import("@/lib/payments/paystack").PaystackClient;

const SECRET = "sk_test_webhooktestkey0001";
const ENV = {
  PAYSTACK_SECRET_KEY: SECRET,
  PAYSTACK_CALLBACK_URL: "https://malihub.example.com/checkout",
};

const BUYER_A = "buyer-a";
const SELLER_1 = "seller-1";
const AMOUNT = 200_000; // KES 2,000.00 in minor units

before(async () => {
  service = await import("@/services/payment-webhook-service");
  ({ PaystackClientError: PaystackClientErrorCtor } = await import("@/lib/payments/paystack"));
});

beforeEach(() => {
  store = createFakeMarketplaceStore();
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
});

function db() {
  return store as never;
}

// ─── Provider stub ───────────────────────────────────────────────────────────

type VerifyAnswer = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  domain?: string;
  id?: number;
};

function stubClient(answer: { ok?: VerifyAnswer; error?: Error }) {
  const calls: string[] = [];
  const client: PaystackClientType = {
    async initializeTransaction() {
      throw new Error("webhook pipeline never initializes");
    },
    async verifyTransaction(reference) {
      calls.push(reference);
      if (answer.error) throw answer.error;
      const base: VerifyAnswer = answer.ok ?? ({ status: "success", reference, amount: AMOUNT, currency: "KES" } as VerifyAnswer);
      return { id: base.id ?? 48_213, status: base.status, reference: base.reference, amount: base.amount, currency: base.currency, domain: base.domain ?? "test" };
    },
  };
  return { client, calls };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function seedListing(quantity = 5, priceCents = 100_000) {
  const seller = seedSeller(store, { userId: SELLER_1, businessName: "Payment Test Shop" });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store, "pay-cat");
  const product = seedProduct(store, {
    sellerId: seller.id,
    ownerId: SELLER_1,
    categoryId: category.id,
    quantity,
    priceCents,
    status: "ACTIVE",
  });
  return { seller, product };
}

async function placeOrder(buyerId: string, productId: string, quantity = 2) {
  seedCartItem(store, buyerId, productId, quantity);
  const { checkoutCart } = await import("@/services/order-service");
  const result = await checkoutCart(db(), buyerId, TEST_DELIVERY);
  return result.orders[0]!;
}

/**
 * A payment row exactly as the initialize route persists it after Paystack
 * accepted the transaction: PROCESSING, our reference, provider-echoed
 * reference in metadata, integer amount in KES minor units.
 */
function seedAcceptedAttempt(orderId: string, reference: string, totalCents: number) {
  return seedPayment(store, {
    orderId,
    customerReference: reference,
    provider: "PAYSTACK",
    status: "PROCESSING",
    amountCents: totalCents,
    currency: "KES",
    metadata: { paystack: { accessCode: "ac-test", providerReference: reference, initialization: "accepted" } },
  });
}

function chargeSuccessBody(reference: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "charge.success",
    data: {
      id: 48_213,
      reference,
      amount: AMOUNT,
      currency: "KES",
      status: "success",
      domain: "test",
      channel: "mobile_money",
      customer: {
        email: "buyer-a@example.com",
        phone: "0712345678",
        first_name: "Emmanuel",
        last_name: "Yegon",
        international_format_phone: "+254712345678",
      },
      ...overrides,
    },
  });
}

function sign(body: string, key: string = SECRET): string {
  return createHmac("sha512", key).update(body).digest("hex");
}

function delivery(body: string, signature: string | null) {
  return service.handlePaystackWebhook(db(), { rawBody: body, signature, client: stubClient({}).client, env: ENV });
}

const payments = () => [...store.tables.payments.values()];
const events = () => [...store.tables.paymentEvents.values()];
const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);

// ─── Gate 0: configuration (fail closed) ────────────────────────────────────

describe("configuration — the pipeline is fail-closed", () => {
  it("refuses every delivery when the provider is not configured", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    const outcome = await service.handlePaystackWebhook(db(), {
      rawBody: body,
      signature: sign(body),
      client: stubClient({}).client,
      env: {}, // no PAYSTACK_SECRET_KEY — cannot verify anything
    });

    assert.deepEqual(outcome, { kind: "invalid_signature" });
    assert.equal(events().length, 0, "unverifiable bytes are not recorded");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── Gate 1: signature ───────────────────────────────────────────────────────

describe("signature gate — a forged or malformed delivery settles nothing", () => {
  async function setup() {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    return { order, payment, body };
  }

  it("refuses a delivery with no signature header", async () => {
    const { order, body } = await setup();
    const outcome = await delivery(body, null);
    assert.deepEqual(outcome, { kind: "invalid_signature" });
    assert.equal(events().length, 0);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("refuses a signature computed with the wrong key", async () => {
    const { order, body } = await setup();
    const outcome = await delivery(body, sign(body, "sk_test_someone_else"));
    assert.deepEqual(outcome, { kind: "invalid_signature" });
    assert.equal(events().length, 0);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("refuses a signature over a TAMPERED body (signed, then altered)", async () => {
    const { order, body } = await setup();
    const signature = sign(body);
    const tampered = body.replace(String(AMOUNT), String(AMOUNT + 1));
    const outcome = await delivery(tampered, signature);
    assert.deepEqual(outcome, { kind: "invalid_signature" });
    assert.equal(events().length, 0);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("refuses a signature that is not 128 hex chars", async () => {
    const { body } = await setup();
    const outcome = await delivery(body, "deadbeef");
    assert.deepEqual(outcome, { kind: "invalid_signature" });
    assert.equal(events().length, 0);
  });
});

// ─── Gate 2: envelope shape ──────────────────────────────────────────────────

describe("envelope gate — the documented { event, data } shape or nothing", () => {
  const badBodies: Array<[string, string]> = [
    ["not json at all", "this is not json"],
    ["json array", "[1,2,3]"],
    ["missing event", '{"data":{"reference":"x"}}'],
    ["empty event", '{"event":"","data":{"reference":"x"}}'],
    ["event not a string", '{"event":7,"data":{"reference":"x"}}'],
    ["missing data", '{"event":"charge.success"}'],
    ["data is an array", '{"event":"charge.success","data":[]}'],
    ["data is a string", '{"event":"charge.success","data":"nope"}'],
  ];
  for (const [label, body] of badBodies) {
    it(`refuses ${label}`, async () => {
      const outcome = await delivery(body, sign(body));
      assert.deepEqual(outcome, { kind: "invalid_payload" });
      assert.equal(events().length, 0, "an unparseable envelope is not recorded");
    });
  }
});

// ─── The legitimate path ─────────────────────────────────────────────────────

describe("charge.success — the legitimate settlement", () => {
  it("settles a matching callback: payment SUCCESS, order PAID, one audit, redacted event", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    const { client, calls } = stubClient({});
    const outcome = await service.handlePaystackWebhook(db(), {
      rawBody: body,
      signature: sign(body),
      client,
      env: ENV,
    });

    assert.equal(outcome.kind, "processed");
    if (outcome.kind !== "processed") throw new Error("unreachable");
    assert.equal(outcome.result, "SUCCESS");
    assert.equal(outcome.orderChanged, true);
    assert.equal(outcome.anomaly, undefined);
    assert.deepEqual(calls, [payment.customerReference], "the provider was re-verified by our reference");

    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.ok(row.paidAt instanceof Date);
    assert.equal(row.providerReference, payment.customerReference);
    assert.equal(row.providerTransactionId, "48213");
    assert.deepEqual(row.rawCallbackPayload, JSON.parse(body), "the verbatim payload is stored on the claim");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");

    const [event] = events();
    assert.ok(event);
    assert.equal(event.paymentId, payment.id);
    assert.equal(event.eventType, "charge.success");
    assert.equal(event.providerEventId, "paystack:charge.success:48213");
    assert.equal(event.processingStatus, "PROCESSED");
    // The redacted copy keeps the record without the payer's personal data.
    const storedCustomer = (event.rawPayload as { data: { customer: Record<string, unknown> } }).data.customer;
    assert.equal(storedCustomer.phone, "[redacted]");
    assert.equal(storedCustomer.first_name, "[redacted]");
    assert.equal(storedCustomer.last_name, "[redacted]");
    assert.equal(storedCustomer.international_format_phone, "[redacted]");
    assert.equal(storedCustomer.email, "buyer-a@example.com", "the email is already on the order; the record keeps it");

    assert.equal(auditsOf("payment.success").length, 1);
    assert.equal(auditsOf("order.paid").length, 1);
  });

  it("a redelivery of the SAME event is provably effect-free", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    const { client } = stubClient({});
    const first = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });
    assert.equal(first.kind, "processed");

    const second = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });
    const third = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });

    assert.deepEqual(second, { kind: "duplicate" });
    assert.deepEqual(third, { kind: "duplicate" });
    assert.equal(events().length, 1, "one event row, no matter how often Paystack retries");
    assert.equal(auditsOf("payment.success").length, 1);
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("a replay also closes the two-step crash window (payment SUCCESS, order still PENDING)", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    const { client } = stubClient({});
    const first = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });
    assert.equal(first.kind, "processed");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");

    // Simulate the crash: the claim committed, the order transition never ran.
    store.tables.orders.get(order.id)!.status = "PENDING";

    const replay = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });

    assert.deepEqual(replay, { kind: "duplicate" });
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID", "the replay recovered the transition");
    assert.equal(auditsOf("payment.success").length, 1, "no second audit from the recovery");
  });
});

// ─── Gate 3: identity ────────────────────────────────────────────────────────

describe("identity gate — references must be ours", () => {
  it("records and ACKs a callback for a reference MaliHub never issued", async () => {
    const body = chargeSuccessBody("MH-STRAANGER-REF");
    const outcome = await delivery(body, sign(body));

    assert.deepEqual(outcome, { kind: "unknown_reference" });
    const [event] = events();
    assert.ok(event);
    assert.equal(event.paymentId, null, "stranger callbacks are recorded without a payment link");
    assert.equal(event.processingStatus, "FAILED");
    assert.equal(payments().length, 0);
  });

  it("treats a transaction-id match with a DISAGREEING reference as an anomaly, not a settlement", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    // The provider id is already on a row whose own reference differs.
    store.tables.payments.get(payment.id)!.providerTransactionId = "48213";

    const body = chargeSuccessBody("MH-DIFFERENT-REF", { id: 48_213, amount: order.totalCents });
    const outcome = await delivery(body, sign(body));

    assert.deepEqual(outcome, { kind: "unknown_reference" });
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "PROCESSING", "a disagreeing callback cannot move the row");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    const anomaly = auditsOf("payment.anomaly");
    assert.equal(anomaly.length, 1);
    assert.equal((anomaly[0]!.metadata as { anomaly?: string }).anomaly, "reference_mismatch");
  });

  it("falls back to the provider-echoed reference when the provider regenerated ours", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    // Edge case: Paystack regenerated the reference; the row carries the
    // provider's version in metadata, and the callback uses that version.
    const providerRef = "MH-PROVIDER-REGEN";
    store.tables.payments.get(payment.id)!.metadata = {
      paystack: { providerReference: providerRef, initialization: "accepted" },
    };

    const body = chargeSuccessBody(providerRef, { amount: order.totalCents });
    const outcome = await delivery(body, sign(body));

    assert.equal(outcome.kind, "processed");
    if (outcome.kind !== "processed") throw new Error("unreachable");
    assert.equal(outcome.orderChanged, true);
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });
});

// ─── Gate 4: amount & currency ───────────────────────────────────────────────

describe("amount/currency gate — exact integer equality in both directions", () => {
  async function setup(amountInCallback: number | undefined) {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const body = chargeSuccessBody(payment.customerReference, {
      ...(amountInCallback !== undefined ? { amount: amountInCallback } : {}),
    });
    return { order, payment, body };
  }

  it("refuses an UNDER-payment", async () => {
    const { order, payment, body } = await setup(AMOUNT - 1);
    const outcome = await delivery(body, sign(body));
    assert.deepEqual(outcome, { kind: "amount_mismatch" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.amount_mismatch").length, 1);
    assert.equal(events()[0]!.processingStatus, "FAILED");
  });

  it("refuses an OVER-payment just the same", async () => {
    const { order, payment, body } = await setup(AMOUNT + 1);
    const outcome = await delivery(body, sign(body));
    assert.deepEqual(outcome, { kind: "amount_mismatch" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("refuses a non-integer amount", async () => {
    const { payment, body } = await setup(200_000.5);
    const outcome = await delivery(body, sign(body));
    assert.deepEqual(outcome, { kind: "amount_mismatch" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
  });

  it("refuses a wrong currency", async () => {
    const { order, payment } = await setup(AMOUNT);
    const body = JSON.stringify({
      event: "charge.success",
      data: { id: 48_213, reference: payment.customerReference, amount: AMOUNT, currency: "NGN", status: "success" },
    });
    const outcome = await delivery(body, sign(body));
    assert.deepEqual(outcome, { kind: "currency_mismatch" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.amount_mismatch").length, 1, "the currency mismatch is audited with the amount detail");
  });
});

// ─── Gate 5: provider re-verification ────────────────────────────────────────

describe("re-verification gate — Paystack's own API is the final word", () => {
  async function setup() {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    return { order, payment, body };
  }

  it("never settles when the provider API is unreachable", async () => {
    const { order, payment, body } = await setup();
    const { client, calls } = stubClient({ error: new PaystackClientErrorCtor("down", "unavailable") });
    const outcome = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });

    assert.equal(outcome.kind, "verification_failed");
    assert.equal(calls.length, 1);
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING", "nothing is settled");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(events()[0]!.processingStatus, "FAILED");
    assert.equal(auditsOf("payment.verification_failed").length, 1);
  });

  it("never settles when the provider says the transaction is NOT success", async () => {
    const { order, payment, body } = await setup();
    const { client } = stubClient({
      ok: { status: "failed", reference: payment.customerReference, amount: AMOUNT, currency: "KES" },
    });
    const outcome = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });

    assert.equal(outcome.kind, "verification_failed");
    assert.match(outcome.kind === "verification_failed" ? outcome.reason : "", /failed/);
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.verification_failed").length, 1);
  });

  it("never settles when the provider's amount disagrees", async () => {
    const { order, payment, body } = await setup();
    const { client } = stubClient({
      ok: { status: "success", reference: payment.customerReference, amount: AMOUNT + 500, currency: "KES" },
    });
    const outcome = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });

    assert.equal(outcome.kind, "verification_failed");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("never settles when the provider's environment disagrees with the configured key", async () => {
    const { order, payment, body } = await setup();
    const { client } = stubClient({
      ok: { status: "success", reference: payment.customerReference, amount: AMOUNT, currency: "KES", domain: "live" },
    });
    const outcome = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });
    assert.equal(outcome.kind, "verification_failed");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.verification_failed").length, 1);
  });

  it("never settles when the provider's currency disagrees", async () => {
    const { order, payment, body } = await setup();
    const { client } = stubClient({
      ok: { status: "success", reference: payment.customerReference, amount: AMOUNT, currency: "NGN" },
    });
    const outcome = await service.handlePaystackWebhook(db(), { rawBody: body, signature: sign(body), client, env: ENV });

    assert.equal(outcome.kind, "verification_failed");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── Supersession & contradictions ───────────────────────────────────────────

describe("supersession — one effective successful payment per order", () => {
  it("a sibling that already settled the order supersedes a late success webhook", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const winner = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-WINNER-${order.id.slice(0, 4)}`,
      provider: "PAYSTACK",
      status: "SUCCESS",
      amountCents: order.totalCents,
      paidAt: new Date(),
    });
    const loser = seedAcceptedAttempt(order.id, `MH-LOSER-${order.id.slice(0, 4)}`, order.totalCents);
    store.tables.orders.get(order.id)!.status = "PAID";

    const body = chargeSuccessBody(loser.customerReference, { id: 99_999, amount: order.totalCents });
    const outcome = await delivery(body, sign(body));

    assert.deepEqual(outcome, { kind: "ignored", reason: "order_already_settled" });
    assert.equal(store.tables.payments.get(loser.id)!.status, "PROCESSING", "the losing attempt is left untouched");
    assert.equal(store.tables.payments.get(winner.id)!.status, "SUCCESS");
    assert.equal(events()[0]!.processingStatus, "IGNORED");
    const anomaly = auditsOf("payment.anomaly");
    assert.equal(anomaly.length, 1);
    assert.equal((anomaly[0]!.metadata as { anomaly?: string }).anomaly, "superseded_success");
  });

  it("a success webhook on an already-FAILED payment is ignored, not applied", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      provider: "PAYSTACK",
      status: "FAILED",
      amountCents: order.totalCents,
    });

    const body = chargeSuccessBody(payment.customerReference, { amount: order.totalCents });
    const outcome = await delivery(body, sign(body));

    assert.deepEqual(outcome, { kind: "ignored", reason: "contradicts_terminal_state" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(events()[0]!.processingStatus, "IGNORED");
    const anomaly = auditsOf("payment.anomaly");
    assert.equal(anomaly.length, 1);
    assert.equal((anomaly[0]!.metadata as { anomaly?: string }).anomaly, "success_after_terminal");
  });
});

// ─── Non-money events ────────────────────────────────────────────────────────

describe("events that do not move money", () => {
  it("records charge.refunded and ACKs it without touching state", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const body = JSON.stringify({
      event: "charge.refunded",
      data: { id: 48_213, reference: payment.customerReference, amount: order.totalCents, currency: "KES", status: "refunded" },
    });
    const outcome = await delivery(body, sign(body));

    assert.deepEqual(outcome, { kind: "recorded_only", event: "charge.refunded" });
    const [event] = events();
    assert.ok(event);
    assert.equal(event.processingStatus, "PROCESSED");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING", "refunds belong to the refund phase");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.success").length, 0);
  });

  it("records and ACKs an unknown event type", async () => {
    const body = JSON.stringify({ event: "subscription.created", data: { id: 1, reference: "x" } });
    const outcome = await delivery(body, sign(body));
    assert.deepEqual(outcome, { kind: "recorded_only", event: "subscription.created" });
  });

  it("dedups a redelivered non-success event", async () => {
    const body = JSON.stringify({ event: "charge.failed", data: { id: 55_555, reference: "MH-NOPE" } });
    const first = await delivery(body, sign(body));
    const second = await delivery(body, sign(body));
    assert.deepEqual(first, { kind: "recorded_only", event: "charge.failed" });
    assert.deepEqual(second, { kind: "duplicate" });
    assert.equal(events().length, 1);
  });
});

// ─── Units: event id, redaction ──────────────────────────────────────────────

describe("paystackEventId", () => {
  it("is stable per event+transaction and distinct across events", () => {
    const a = service.paystackEventId("charge.success", { id: 48_213 }, "hash-a");
    const b = service.paystackEventId("charge.success", { id: 48_213 }, "hash-b");
    const c = service.paystackEventId("charge.failed", { id: 48_213 }, "hash-c");
    assert.equal(a, b, "redelivery of the same event produces the same id");
    assert.notEqual(a, c, "different events for the same transaction differ");
  });

  it("falls back to the payload hash when the payload carries no id", () => {
    assert.equal(service.paystackEventId("charge.success", {}, "hash-x"), "paystack:charge.success:hash-x");
    assert.equal(service.paystackEventId("charge.success", null, "hash-y"), "paystack:charge.success:hash-y");
  });
});

describe("redactPaystackWebhook", () => {
  it("strips payer PII from the customer object and mutates nothing", () => {
    const payload = {
      event: "charge.success",
      data: {
        id: 1,
        reference: "MH-X",
        customer: { email: "a@b.c", phone: "0712345678", first_name: "A", last_name: "B", international_format_phone: "+254712345678" },
      },
    };
    const redacted = service.redactPaystackWebhook(payload);
    const customer = (redacted.data as { customer: Record<string, unknown> }).customer;
    assert.equal(customer.phone, "[redacted]");
    assert.equal(customer.first_name, "[redacted]");
    assert.equal(customer.last_name, "[redacted]");
    assert.equal(customer.international_format_phone, "[redacted]");
    assert.equal(customer.email, "a@b.c");
    // The input is untouched.
    const original = (payload.data as { customer: Record<string, unknown> }).customer;
    assert.equal(original.phone, "0712345678");
  });

  it("tolerates payloads without a customer object", () => {
    assert.deepEqual(service.redactPaystackWebhook({ event: "x", data: {} }), { event: "x", data: {} });
    assert.deepEqual(service.redactPaystackWebhook(null), {});
  });
});
