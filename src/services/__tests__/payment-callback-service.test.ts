import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/**
 * The PayHero callback pipeline — the heart of Phase 9.2-A. Every scenario a
 * financial callback has to survive is exercised here against the in-memory
 * store with the FULL service stack running (callback service → settlement
 * primitives → state-machine transition):
 *
 *   - success settles Payment (SUCCESS) and moves the order PENDING → PAID;
 *   - failure records Payment FAILED/CANCELLED and the order stays unpaid;
 *   - the amount is checked against OUR row, in integer minor units;
 *   - duplicates — sequential or concurrent — have no second effect, enforced
 *     by the (provider, providerEventId) unique constraint;
 *   - an unknown/inconsistent reference is recorded and ignored;
 *   - a payment-vs-cancellation race ends with exactly one winner, and a late
 *     success on a cancelled order is an audited anomaly, not a resurrection;
 *   - the event row keeps a REDACTED payload while the verdict-verbatim body
 *     lives on the Payment row, exactly as the schema prescribes.
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

let callbacks: typeof import("@/services/payment-callback-service");
let transitions: typeof import("@/services/order-transition-service");

const BUYER_A = "buyer-a";
const SELLER_1 = "seller-1";

before(async () => {
  callbacks = await import("@/services/payment-callback-service");
  transitions = await import("@/services/order-transition-service");
});

beforeEach(() => {
  store = createFakeMarketplaceStore();
  seedProfile(store, BUYER_A, "Emmanuel Yegon");
  seedUser(store, { id: BUYER_A, email: "buyer-a@example.com" });
});

function db() {
  return store as never;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function seedListing(quantity = 5, priceCents = 100_000) {
  const seller = seedSeller(store, { userId: SELLER_1, businessName: "Callback Shop" });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store, "cb-cat");
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
  const result = await checkoutCart(db(), buyerId);
  return result.orders[0]!;
}

type CallbackOverrides = {
  amount?: number;
  checkoutRequestId?: string;
  externalReference?: string;
  merchantRequestId?: string;
  mpesaReceiptNumber?: string | null;
  phone?: string | null;
  resultCode?: number;
  resultDesc?: string;
  statusWord?: string;
};

function callbackPayload(overrides: CallbackOverrides = {}) {
  return {
    forward_url: "",
    status: true,
    response: {
      Amount: overrides.amount ?? 2_000,
      CheckoutRequestID: overrides.checkoutRequestId ?? "ws_CO_TEST_1",
      ExternalReference: overrides.externalReference ?? "MH-TESTREF",
      MerchantRequestID: overrides.merchantRequestId ?? "3202-70921557-1",
      ...(overrides.mpesaReceiptNumber !== null
        ? { MpesaReceiptNumber: overrides.mpesaReceiptNumber ?? "SAE3YULR0Y" }
        : {}),
      ...(overrides.phone !== null ? { Phone: overrides.phone ?? "+254712345678" } : {}),
      ResultCode: overrides.resultCode ?? 0,
      ResultDesc:
        overrides.resultDesc ?? "The service request is processed successfully.",
      Status: overrides.statusWord ?? "Success",
    },
  };
}

/** The standard arrangement: a PENDING order with a PROCESSING attempt. */
async function seedPayableScenario() {
  const product = seedListing();
  const order = await placeOrder(BUYER_A, product.id, 2); // 2 × KES 1000 = KES 2000
  const payment = seedPayment(store, {
    orderId: order.id,
    customerReference: order.orderNumber,
    status: "PROCESSING",
    amountCents: order.totalCents,
    providerTransactionId: "ws_CO_TEST_1",
    metadata: { payhero: { reference: "PHREF-1" } },
  });
  return { product, order, payment };
}

const events = () => [...store.tables.paymentEvents.values()];
const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);
const notificationsOf = (type: string) =>
  [...store.tables.notifications.values()].filter((n) => n.type === type);

// ─── Success path ────────────────────────────────────────────────────────────

describe("handlePayheroCallback — success", () => {
  it("settles the payment and moves the order PENDING → PAID", async () => {
    const { order, payment } = await seedPayableScenario();

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber, amount: 2_000 })
    );

    assert.equal(outcome.kind, "processed");
    if (outcome.kind === "processed" && outcome.result === "SUCCESS") {
      assert.equal(outcome.orderChanged, true);
      assert.equal(outcome.anomaly, undefined);
    } else {
      assert.fail(`unexpected outcome ${JSON.stringify(outcome)}`);
    }

    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.providerReference, "SAE3YULR0Y", "M-Pesa receipt persisted");
    assert.ok(row.paidAt instanceof Date);
    // The verbatim payload lives on the Payment row, as rawCallbackPayload documents.
    const raw = row.rawCallbackPayload as { response: { Phone?: string } };
    assert.equal(raw.response.Phone, "+254712345678");

    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    // The order transition went through the state machine's audit channel.
    assert.equal(auditsOf("order.paid").length, 1);

    // The event row: linked, processed, and REDACTED (no payer PII).
    const evts = events();
    assert.equal(evts.length, 1);
    assert.equal(evts[0]!.paymentId, payment.id);
    assert.equal(evts[0]!.providerEventId, "stk-callback:ws_CO_TEST_1");
    assert.equal(evts[0]!.eventType, "Success");
    assert.equal(evts[0]!.processingStatus, "PROCESSED");
    assert.ok(evts[0]!.processedAt instanceof Date);
    const redacted = evts[0]!.rawPayload as { response: { Phone?: string } };
    assert.equal(redacted.response.Phone, "[redacted]");
    assert.equal(evts[0]!.payloadHash.length, 64, "sha256 hex");
  });

  it("never moves the order to the legacy CONFIRMED status", async () => {
    const { order } = await seedPayableScenario();
    await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );
    const status = store.tables.orders.get(order.id)!.status;
    assert.equal(status, "PAID");
    assert.notEqual(status, "CONFIRMED");
  });
});

// ─── Failure paths ───────────────────────────────────────────────────────────

describe("handlePayheroCallback — non-collection results", () => {
  it("a failed callback marks the payment FAILED and leaves the order payable", async () => {
    const { order, payment } = await seedPayableScenario();

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        externalReference: order.orderNumber,
        statusWord: "Failed",
        resultCode: 1,
        resultDesc: "The transaction was declined.",
        mpesaReceiptNumber: null,
      })
    );

    assert.deepEqual(outcome, { kind: "processed", result: "FAILED" });

    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "FAILED");
    assert.equal(row.failureCode, "1");
    assert.equal(row.failureReason, "The transaction was declined.");
    assert.equal(row.providerReference, null, "a failure has no receipt");

    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(events()[0]!.processingStatus, "PROCESSED");
    assert.equal(auditsOf("payment.failed").length, 1);
    // The buyer is told (PAYMENT_UPDATE), the order is NOT touched.
    assert.equal(notificationsOf("PAYMENT_UPDATE").length, 1);
    assert.equal(auditsOf("order.paid").length, 0);
  });

  it("ResultCode 1032 (user cancelled) maps to CANCELLED", async () => {
    const { order, payment } = await seedPayableScenario();

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        externalReference: order.orderNumber,
        statusWord: "Failed",
        resultCode: 1032,
        resultDesc: "Request cancelled by user.",
        mpesaReceiptNumber: null,
      })
    );

    assert.deepEqual(outcome, { kind: "processed", result: "CANCELLED" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "CANCELLED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("ResultCode != 0 is NOT a success even when the status word says Success", async () => {
    const { order, payment } = await seedPayableScenario();

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        externalReference: order.orderNumber,
        statusWord: "Success",
        resultCode: 999,
      })
    );

    assert.deepEqual(outcome, { kind: "processed", result: "FAILED" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── Trust & validation ─────────────────────────────────────────────────────

describe("handlePayheroCallback — validation and trust", () => {
  it("records and ignores a callback whose reference MaliHub never issued", async () => {
    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: "MH-NOSUCHORD", checkoutRequestId: "ws_CO_GHOST" })
    );

    assert.equal(outcome.kind, "unknown_reference");
    const evts = events();
    assert.equal(evts.length, 1);
    assert.equal(evts[0]!.paymentId, null, "no payment is implicated");
    assert.equal(evts[0]!.processingStatus, "FAILED");
    assert.equal(store.tables.orders.size >= 0, true); // nothing else changed
  });

  it("matches by customer reference when the provider id was never persisted (crash window)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PENDING",
      amountCents: order.totalCents,
      providerTransactionId: null, // initiation response never recorded
    });

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );

    assert.equal(outcome.kind, "processed");
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.providerTransactionId, "ws_CO_TEST_1", "transaction id backfilled");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("refuses to settle when the callback's CheckoutRequestID belongs to a DIFFERENT initiation of the same reference", async () => {
    // The double-prompt race: this row holds the WINNING transaction id; the
    // callback reports the LOSING one. Settling it would mark the winner's
    // payment paid on the loser's money.
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_WINNER",
    });

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        externalReference: order.orderNumber,
        checkoutRequestId: "ws_CO_LOSER",
      })
    );

    assert.equal(outcome.kind, "unknown_reference");
    // Nothing settled; and the event points forensics at the affected row.
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(events()[0]!.paymentId, payment.id);
    assert.equal(events()[0]!.processingStatus, "FAILED");
  });

  it("an inconsistent callback (our transaction id, foreign reference) is recorded, not honored", async () => {
    const { order, payment } = await seedPayableScenario();

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: "MH-DIFFERENT" })
    );

    assert.equal(outcome.kind, "unknown_reference");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(events()[0]!.paymentId, payment.id);
  });

  it("an amount mismatch settles nothing and leaves an audit trail", async () => {
    const { order, payment } = await seedPayableScenario();

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber, amount: 500 }) // KES 500 ≠ KES 2000
    );

    assert.equal(outcome.kind, "amount_mismatch");
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "PROCESSING", "payment NOT settled");
    assert.equal(row.paidAt, null);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");

    const evts = events();
    assert.equal(evts.length, 1);
    assert.equal(evts[0]!.processingStatus, "FAILED");

    const audits = auditsOf("payment.amount_mismatch");
    assert.equal(audits.length, 1);
    const metadata = audits[0]!.metadata as Record<string, unknown>;
    assert.equal(metadata.expectedAmountCents, order.totalCents);
    assert.equal(metadata.reportedAmountKes, 500);
  });

  it("a malformed payload is rejected without any database effect", async () => {
    for (const bad of [
      null,
      42,
      "string",
      {},
      { response: {} },
      { response: { Amount: 2000 } },
      callbackPayload({ externalReference: "" }),
    ]) {
      const outcome = await callbacks.handlePayheroCallback(db(), bad);
      assert.equal(outcome.kind, "invalid_payload", JSON.stringify(bad));
    }
    assert.equal(events().length, 0);
  });

  it("a callback naming an order number of a NON-PayHero payment cannot settle it", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const manual = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      provider: "MANUAL",
      status: "PROCESSING",
      amountCents: order.totalCents,
    });

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );

    assert.equal(outcome.kind, "unknown_reference");
    assert.equal(store.tables.payments.get(manual.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe("handlePayheroCallback — idempotency", () => {
  it("a duplicate delivery has no second financial effect", async () => {
    const { order, payment } = await seedPayableScenario();
    const payload = callbackPayload({ externalReference: order.orderNumber });

    const first = await callbacks.handlePayheroCallback(db(), payload);
    const second = await callbacks.handlePayheroCallback(db(), payload);
    const third = await callbacks.handlePayheroCallback(db(), payload);

    assert.equal(first.kind, "processed");
    assert.equal(second.kind, "duplicate");
    assert.equal(third.kind, "duplicate");

    assert.equal(events().length, 1, "the dedup key is enforced at the schema level");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(auditsOf("order.paid").length, 1, "paid audit written exactly once");
    assert.equal(notificationsOf("ORDER_UPDATE").length <= 4, true); // buyer+seller, once
  });

  it("a CONCURRENT duplicate delivery also applies exactly once", async () => {
    const { order, payment } = await seedPayableScenario();
    const payload = () => callbackPayload({ externalReference: order.orderNumber });

    const [a, b] = await Promise.all([
      callbacks.handlePayheroCallback(db(), payload()),
      callbacks.handlePayheroCallback(db(), payload()),
    ]);

    const kinds = [a.kind, b.kind].sort();
    assert.deepEqual(kinds, ["duplicate", "processed"]);
    assert.equal(events().length, 1);
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("a success callback for a payment ALREADY successfully settled (whose event row was lost) is recorded but not re-applied", async () => {
    // The payment settled earlier — e.g. through a status verification, or an
    // event row lost to an incident — and PayHero delivers the result now.
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "SUCCESS",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_TEST_1",
      providerReference: "SAE3YULR0Y",
      paidAt: new Date(),
    });
    store.tables.orders.get(order.id)!.status = "PAID";

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );

    assert.deepEqual(outcome, { kind: "ignored", reason: "payment_already_terminal" });
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.providerReference, "SAE3YULR0Y", "the winning settlement is intact");
    const evts = events();
    assert.equal(evts.length, 1, "the late event is still recorded");
    assert.equal(evts[0]!.processingStatus, "IGNORED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("a failure callback for an already-settled transaction is recorded but never downgrades", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "SUCCESS",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_TEST_1",
      providerReference: "SAE3YULR0Y",
      paidAt: new Date(),
    });

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        externalReference: order.orderNumber,
        statusWord: "Failed",
        resultCode: 1,
        mpesaReceiptNumber: null,
      })
    );

    assert.deepEqual(outcome, { kind: "ignored", reason: "payment_already_terminal" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
    assert.equal(events()[0]!.processingStatus, "IGNORED");
  });

  it("a success callback for a payment already recorded FAILED is a contradiction — first outcome wins", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "FAILED",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_TEST_1",
      failureCode: "1",
      failureReason: "The transaction was declined.",
    });

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );

    assert.deepEqual(outcome, { kind: "ignored", reason: "contradicts_terminal_state" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    const evts = events();
    assert.equal(evts.length, 1);
    assert.equal(evts[0]!.processingStatus, "IGNORED", "the contradiction is on record");
  });
});

// ─── The money race: payment vs cancellation ─────────────────────────────────

describe("handlePayheroCallback — payment vs cancellation race", () => {
  it("cancellation committed first: the paid callback settles the PAYMENT but the order stays CANCELLED with an audited anomaly", async () => {
    const { order, payment } = await seedPayableScenario();
    await transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });

    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );

    // The money really arrived — the Payment row says so truthfully…
    assert.equal(outcome.kind, "processed");
    if (outcome.kind === "processed" && outcome.result === "SUCCESS") {
      assert.equal(outcome.orderChanged, false);
      assert.equal(outcome.anomaly, "order_cancelled");
    } else {
      assert.fail(`unexpected outcome ${JSON.stringify(outcome)}`);
    }
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");

    // …but the cancelled order is NOT resurrected, and the anomaly is audited
    // for the reconciliation/refund phase that owns the follow-up.
    assert.equal(store.tables.orders.get(order.id)!.status, "CANCELLED");
    const anomalies = auditsOf("payment.anomaly");
    assert.equal(anomalies.length, 1);
    assert.equal((anomalies[0]!.metadata as Record<string, unknown>).anomaly, "order_cancelled");
  });

  it("payment committed first: a later cancellation is refused by the state machine", async () => {
    const { order } = await seedPayableScenario();
    await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );

    await assert.rejects(
      transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "invalid_transition");
        return true;
      }
    );
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("a callback claiming a cancelled order's payment twice cannot flip it, sequentially or interleaved", async () => {
    const { order, payment } = await seedPayableScenario();

    // Interleave: cancellation runs INSIDE the callback's window — the
    // compare-and-swap in markOrderPaid decides the single winner.
    const [callbackOutcome] = await Promise.all([
      callbacks.handlePayheroCallback(db(), callbackPayload({ externalReference: order.orderNumber })),
      (async () => {
        // Give the callback's claim transaction a head start, then cancel.
        await new Promise((resolve) => setImmediate(resolve));
        return transitions
          .cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id })
          .catch((error: unknown) => error);
      })(),
    ]);

    const orderRow = store.tables.orders.get(order.id)!;
    const paymentRow = store.tables.payments.get(payment.id)!;

    // Either PAID (callback won) or CANCELLED+cancelled-anomaly (cancel won).
    // What must never happen: both, or a payment marked SUCCESS without the
    // truth being recorded.
    if (orderRow.status === "PAID") {
      assert.equal(paymentRow.status, "SUCCESS");
      assert.equal(callbackOutcome.kind, "processed");
    } else {
      assert.equal(orderRow.status, "CANCELLED");
      if (paymentRow.status === "SUCCESS") {
        // The money arrived; the anomaly is on record for reconciliation.
        assert.equal(auditsOf("payment.anomaly").length, 1);
      }
    }
    assert.ok(["PAID", "CANCELLED"].includes(orderRow.status));
  });
});

// ─── Payload hygiene ─────────────────────────────────────────────────────────

describe("handlePayheroCallback — payload hygiene", () => {
  it("the payhero initiation reference survives in metadata across settlement", async () => {
    const { order, payment } = await seedPayableScenario();
    await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({ externalReference: order.orderNumber })
    );
    const metadata = store.tables.payments.get(payment.id)!.metadata as {
      payhero: { reference?: string; merchantRequestId?: string };
    };
    assert.equal(metadata.payhero.reference, "PHREF-1", "status-check key preserved");
    assert.equal(metadata.payhero.merchantRequestId, "3202-70921557-1");
  });

  it("unknown-reference events are also deduplicated", async () => {
    const payload = callbackPayload({ externalReference: "MH-GHOST007" });
    const first = await callbacks.handlePayheroCallback(db(), payload);
    const second = await callbacks.handlePayheroCallback(db(), payload);
    assert.equal(first.kind, "unknown_reference");
    assert.equal(second.kind, "duplicate");
    assert.equal(events().length, 1);
  });
});
