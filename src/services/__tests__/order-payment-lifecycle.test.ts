import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

mock.module("server-only", { namedExports: {} });

/**
 * End-to-end order → payment lifecycle against the in-memory store, using the
 * REAL service stack that now exists:
 *
 *   checkoutCart (order creation)
 *     → readBuyerPaymentSnapshot / verifyBuyerPaymentStatus (buyer reads)
 *     → handlePaystackWebhook (the signed callback that settles)
 *     → verifyPaystackPaymentStatus (the recovery/verification channel)
 *
 * The initialization step (browser → `POST /api/payments/paystack/initialize`
 * → Paystack) is an HTTP boundary; the row that route persists is simulated
 * exactly as that route writes it, and every settlement in this suite goes
 * through the same conditional claims a real delivery would.
 *
 * What the suite proves end to end:
 *   1. An order is PENDING and payable until a VERIFIED success lands —
 *      neither the buyer's browser nor an unverified webhook can PAID it.
 *   2. The webhook and the verification channel settle exactly once and can
 *      never fork: whichever settles first wins, the other is effect-free.
 *   3. Ownership is enforced on every buyer-facing read.
 *   4. Legacy (PAYHERO) rows stay visible and honestly unverifiable.
 *   5. The attempt cap is reported and honoured by the snapshot.
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

let webhookService: typeof import("@/services/payment-webhook-service");
let statusService: typeof import("@/services/payment-status-service");

const SECRET = "sk_test_lifecyclekey0001";
const ENV = {
  PAYSTACK_SECRET_KEY: SECRET,
  PAYSTACK_CALLBACK_URL: "https://malihub.example.com/checkout",
};

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";
const SELLER_1 = "seller-1";
const AMOUNT = 200_000;

before(async () => {
  webhookService = await import("@/services/payment-webhook-service");
  statusService = await import("@/services/payment-status-service");
});

beforeEach(() => {
  store = createFakeMarketplaceStore();
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedProfile(store, BUYER_B, "Grace Atieno");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
  seedUser(store, { id: BUYER_B, email: "buyer-b@example.com" });
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
  id?: number;
};

function stubClient(answer: { ok?: VerifyAnswer; error?: Error }) {
  const calls: string[] = [];
  const client: import("@/lib/payments/paystack").PaystackClient = {
    async initializeTransaction() {
      throw new Error("lifecycle tests never initialize");
    },
    async verifyTransaction(reference) {
      calls.push(reference);
      if (answer.error) throw answer.error;
      const base: VerifyAnswer = answer.ok ?? ({ status: "success", reference, amount: AMOUNT, currency: "KES" } as VerifyAnswer);
      return {
        id: base.id ?? 48_213,
        status: base.status,
        reference: base.reference,
        amount: base.amount,
        currency: base.currency,
        domain: "test",
      };
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
  const result = await checkoutCart(db(), buyerId);
  return result.orders[0]!;
}

/**
 * The row the `POST /api/payments/paystack/initialize` route persists after
 * Paystack accepts the transaction: PROCESSING, our unguessable reference,
 * the provider-echoed reference in metadata, the exact order amount in KES
 * minor units. Simulated here because the route itself is the HTTP boundary.
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

function chargeSuccessBody(reference: string, amount: number, id = 48_213) {
  return JSON.stringify({
    event: "charge.success",
    data: { id, reference, amount, currency: "KES", status: "success", domain: "test", channel: "mobile_money" },
  });
}

function sign(body: string, key: string = SECRET): string {
  return createHmac("sha512", key).update(body).digest("hex");
}

const events = () => [...store.tables.paymentEvents.values()];
const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);

// ─── 1. Order creation → payable snapshot ───────────────────────────────────

describe("1 — checkout creates a PENDING, payable order", () => {
  it("the snapshot shows the order awaiting payment with no attempts", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const snapshot = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_A,
      orderId: order.id,
    });

    assert.ok(snapshot);
    assert.equal(snapshot.order.status, "PENDING");
    assert.equal(snapshot.order.totalCents, order.totalCents);
    assert.equal(snapshot.payment, null);
    assert.equal(snapshot.payable, true);
    assert.equal(snapshot.awaitingConfirmation, false);
    assert.equal(snapshot.canInitiate, true);
    assert.deepEqual(snapshot.attempts, { used: 0, max: 5, remaining: 5 });
  });
});

// ─── 2. The signed webhook is the only settlement that matters ─────────────

describe("2 — a signed, verified webhook settles exactly once", () => {
  it("full lifecycle: PENDING → (accepted attempt) → webhook → PAID, with one audit each", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    // While waiting, the buyer's read shows the attempt but nothing is paid.
    const waiting = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_A,
      orderId: order.id,
    });
    assert.equal(waiting!.payment!.status, "PROCESSING");
    assert.equal(waiting!.awaitingConfirmation, true);
    assert.equal(waiting!.order.status, "PENDING");

    // The callback arrives, signed.
    const body = chargeSuccessBody(payment.customerReference, order.totalCents);
    const { client } = stubClient({});
    const outcome = await webhookService.handlePaystackWebhook(db(), {
      rawBody: body,
      signature: sign(body),
      client,
      env: ENV,
    });

    assert.equal(outcome.kind, "processed");
    if (outcome.kind !== "processed") throw new Error("unreachable");
    assert.equal(outcome.orderChanged, true);
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(auditsOf("payment.success").length, 1);
    assert.equal(auditsOf("order.paid").length, 1);
    assert.equal(events().length, 1);

    // The buyer's read now shows the paid order and the receipt reference.
    const settled = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_A,
      orderId: order.id,
    });
    assert.equal(settled!.order.status, "PAID");
    assert.equal(settled!.payment!.status, "SUCCESS");
    assert.equal(settled!.payment!.providerReference, payment.customerReference);
    assert.equal(settled!.payable, false);
    assert.equal(settled!.awaitingConfirmation, false);

    // A status check after settlement has nothing to verify.
    const checked = await statusService.verifyBuyerPaymentStatus(db(), {
      userId: BUYER_A,
      orderId: order.id,
      client: stubClient({}).client,
      env: ENV,
    });
    assert.equal(checked!.verification, null, "nothing is waiting on the provider");
    assert.equal(checked!.order.status, "PAID");
  });

  it("an unsigned or forged callback can NEVER move the order", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const body = chargeSuccessBody(payment.customerReference, order.totalCents);

    for (const signature of [null, sign(body, "sk_test_forger"), sign(body.slice(0, -4) + "xxxx")]) {
      const outcome = await webhookService.handlePaystackWebhook(db(), {
        rawBody: body,
        signature,
        client: stubClient({}).client,
        env: ENV,
      });
      assert.deepEqual(outcome, { kind: "invalid_signature" }, `for signature ${signature?.slice(0, 8)}`);
    }

    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(events().length, 0);
    assert.equal(auditsOf("payment.success").length, 0);
  });
});

// ─── 3. The two channels cannot fork ────────────────────────────────────────

describe("3 — webhook and verification channel settle exactly once, no fork", () => {
  it("verification first: the webhook that follows is effect-free", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client } = stubClient({
      ok: { status: "success", reference: payment.customerReference, amount: order.totalCents, currency: "KES", id: 48_213 },
    });

    const verified = await statusService.verifyBuyerPaymentStatus(db(), {
      userId: BUYER_A,
      orderId: order.id,
      client,
      env: ENV,
    });
    const v = verified!.verification!;
    assert.equal(v.attempted, true);
    assert.equal(v.ok, true);
    assert.equal(v.outcome, "verified_success");
    assert.equal(verified!.order.status, "PAID");

    // Now Paystack's webhook arrives (it always does, eventually).
    const body = chargeSuccessBody(payment.customerReference, order.totalCents);
    const webhook = await webhookService.handlePaystackWebhook(db(), {
      rawBody: body,
      signature: sign(body),
      client: stubClient({}).client,
      env: ENV,
    });
    assert.deepEqual(webhook, { kind: "ignored", reason: "payment_already_terminal" });

    assert.equal(auditsOf("payment.success").length, 1, "exactly one success audit across both channels");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("webhook first: a subsequent verification is a read, not a second settlement", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const body = chargeSuccessBody(payment.customerReference, order.totalCents);
    const webhook = await webhookService.handlePaystackWebhook(db(), {
      rawBody: body,
      signature: sign(body),
      client: stubClient({}).client,
      env: ENV,
    });
    assert.equal(webhook.kind, "processed");

    const checked = await statusService.verifyBuyerPaymentStatus(db(), {
      userId: BUYER_A,
      orderId: order.id,
      client: stubClient({}).client,
      env: ENV,
    });
    assert.equal(checked!.verification, null, "nothing left to verify");
    assert.equal(checked!.order.status, "PAID");
    assert.equal(auditsOf("payment.success").length, 1);
  });
});

// ─── 4. Ownership on every buyer-facing read ────────────────────────────────

describe("4 — ownership", () => {
  it("another buyer's order is a 404-equivalent, identically to a missing one", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedAcceptedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    const foreign = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_B,
      orderId: order.id,
    });
    assert.equal(foreign, null);

    const missing = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_B,
      orderId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    assert.equal(missing, null);

    const foreignVerify = await statusService.verifyBuyerPaymentStatus(db(), {
      userId: BUYER_B,
      orderId: order.id,
      client: stubClient({}).client,
      env: ENV,
    });
    assert.equal(foreignVerify, null, "verification is ownership-gated too");
  });
});

// ─── 5. Legacy rows stay visible and honestly unverifiable ──────────────────

describe("5 — historical PAYHERO rows", () => {
  it("a legacy PROCESSING row stays on the buyer's screen and reports provider_retired", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const legacy = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      provider: "PAYHERO",
      status: "PROCESSING",
      amountCents: order.totalCents,
      metadata: { payhero: { reference: "PH-LEGACY" } },
    });
    const { client, calls } = stubClient({});

    const snapshot = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_A,
      orderId: order.id,
    });
    assert.equal(snapshot!.payment!.provider, "PAYHERO", "the legacy attempt is still visible");
    assert.equal(snapshot!.awaitingConfirmation, true);

    const checked = await statusService.verifyBuyerPaymentStatus(db(), {
      userId: BUYER_A,
      orderId: order.id,
      client,
      env: ENV,
    });
    assert.deepEqual(checked!.verification, { attempted: true, ok: false, code: "provider_retired" });
    assert.equal(calls.length, 0, "the retired row is never asked of the live provider");
    assert.equal(store.tables.payments.get(legacy.id)!.status, "PROCESSING", "and left exactly as it was");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── 6. The attempt cap is surfaced through the snapshot ────────────────────

describe("6 — attempt cap", () => {
  it("five terminal attempts make the order un-initiable (but not un-joinable rules are the route's)", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    for (let i = 0; i < 5; i++) {
      seedPayment(store, {
        orderId: order.id,
        customerReference: `MH-ATTEMPT-${i}-${order.id.slice(0, 4)}`,
        provider: "PAYSTACK",
        status: "FAILED",
        amountCents: order.totalCents,
        retryCount: i,
      });
    }

    const snapshot = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_A,
      orderId: order.id,
    });

    assert.equal(snapshot!.attempts.used, 5);
    assert.equal(snapshot!.attempts.remaining, 0);
    assert.equal(snapshot!.canInitiate, false, "no NEW attempt is offered at the cap");
  });

  it("an in-flight attempt is always joinable, even at the cap", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    for (let i = 0; i < 4; i++) {
      seedPayment(store, {
        orderId: order.id,
        customerReference: `MH-OLD-${i}-${order.id.slice(0, 4)}`,
        provider: "PAYSTACK",
        status: "FAILED",
        amountCents: order.totalCents,
        retryCount: i,
      });
    }
    seedAcceptedAttempt(order.id, `MH-LIVE-${order.id.slice(0, 4)}`, order.totalCents);

    const snapshot = await statusService.readBuyerPaymentSnapshot(db(), {
      userId: BUYER_A,
      orderId: order.id,
    });

    assert.equal(snapshot!.attempts.used, 5);
    assert.equal(snapshot!.awaitingConfirmation, true);
    assert.equal(snapshot!.canInitiate, true, "joining the live attempt is never capped");
  });
});
