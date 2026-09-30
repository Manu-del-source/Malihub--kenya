import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type {
  PayheroClient,
  PayheroStkPushResult,
  PayheroTransactionStatus,
  PayheroTransactionStatusResult,
} from "@/lib/payments/payhero";

mock.module("server-only", { namedExports: {} });

/**
 * Phase 9.3 — the complete Order ↔ Payment lifecycle, end to end.
 *
 * The earlier payment suites (9.2-A) proved each mechanism in isolation; this
 * suite proves the INVARIANTS hold when attempts, retries, duplicates, races
 * and cancellations combine:
 *
 *   A. A PENDING order may accumulate failed/cancelled attempts, but at most
 *      one effective successful payment.
 *   B/C. Success belongs to exactly one order; an order never carries two
 *      successful payments — even under a Payment A vs Payment B race.
 *   D/E. FAILED/CANCELLED/PROCESSING attempts never pay for an order.
 *   F. A callback for an obsolete attempt never becomes a second settlement.
 *   G. Cancellation and payment success stay mutually exclusive from PENDING;
 *      a late success on a cancelled order is an audited anomaly, and Phase
 *      9.1's inventory restoration runs exactly once, never twice.
 *   H. An already-PAID order rejects initiation and absorbs stray callbacks
 *      as harmless, audited no-ops.
 *   I. Only exact-amount successes settle (integer cents, no float).
 *   J. The two-step settle's crash window (payment SUCCESS, order PENDING)
 *      heals itself on replay and on verification.
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
  type PaymentRow,
} from "./fake-marketplace-store";

let service: typeof import("@/services/payment-service");
let callbacks: typeof import("@/services/payment-callback-service");
let transitions: typeof import("@/services/order-transition-service");

const BUYER_A = "buyer-a";
const SELLER_1 = "seller-1";
const ACTOR_A = { userId: BUYER_A, email: "buyer-a@example.com", accountPhone: "0712345678" };

before(async () => {
  service = await import("@/services/payment-service");
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
  const seller = seedSeller(store, { userId: SELLER_1, businessName: "Lifecycle Shop" });
  seedUser(store, { id: SELLER_1, email: "seller-1@example.com", role: "SELLER" });
  const category = seedCategory(store, "lifecycle-cat");
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
  return result.orders[0]!; // 2 × KES 1000 = KES 2000 by default fixture
}

type StkCall = { params: unknown; coId: string };

/** A PayHero client whose STK push always QUEUES; records calls. */
function recordingStkClient() {
  const calls: StkCall[] = [];
  let n = 0;
  const client = {
    initiateStkPush: async (params: unknown): Promise<PayheroStkPushResult> => {
      n += 1;
      const coId = `ws_CO_LC_${n}`;
      calls.push({ params, coId });
      return { reference: `PHREF-LC-${n}`, checkoutRequestId: coId, status: "QUEUED" };
    },
    getTransactionStatus: async (): Promise<PayheroTransactionStatus> => {
      throw new Error("transaction status not scripted in this test");
    },
  } as unknown as PayheroClient;
  return { client, calls };
}

/** A PayHero client for verification tests, scripted per reference. */
function verificationClient(script: Record<string, PayheroTransactionStatusResult>) {
  const lookedUp: string[] = [];
  const client = {
    initiateStkPush: async (): Promise<PayheroStkPushResult> => {
      throw new Error("STK push not scripted in this test");
    },
    getTransactionStatus: async (reference: string): Promise<PayheroTransactionStatusResult> => {
      lookedUp.push(reference);
      const answer = script[reference] ?? script["*"];
      if (!answer) throw new Error(`no scripted status for ${reference}`);
      return answer;
    },
  } as unknown as PayheroClient;
  return { client, lookedUp };
}

const txStatus = (
  status: PayheroTransactionStatus,
  extra: Partial<PayheroTransactionStatusResult> = {}
): PayheroTransactionStatusResult => ({
  knownStatus: true,
  status,
  rawStatus: status,
  providerReference: status === "SUCCESS" ? `RCP-${status}` : null,
  checkoutRequestId: status === "SUCCESS" ? "ws_CO_LC_VERIFY" : null,
  ...extra,
});

type CallbackOverrides = {
  amount?: number;
  checkoutRequestId?: string;
  externalReference?: string;
  mpesaReceiptNumber?: string | null;
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
      MerchantRequestID: "3202-70921557-1",
      ...(overrides.mpesaReceiptNumber !== null
        ? { MpesaReceiptNumber: overrides.mpesaReceiptNumber ?? "SAE3YULR0Y" }
        : {}),
      Phone: "+254712345678",
      ResultCode: overrides.resultCode ?? 0,
      ResultDesc:
        overrides.resultDesc ?? "The service request is processed successfully.",
      Status: overrides.statusWord ?? "Success",
    },
  };
}

/** PROCESSING attempt `A` (first attempt: bare order number reference). */
function seedAttemptA(order: { id: string; totalCents: number; orderNumber: string }) {
  return seedPayment(store, {
    orderId: order.id,
    customerReference: order.orderNumber,
    status: "PROCESSING",
    amountCents: order.totalCents,
    providerTransactionId: "ws_CO_A",
    retryCount: 0,
    metadata: { payhero: { reference: "PHREF-A" } },
  });
}

/** PROCESSING attempt `B` (first retry: deterministic `-R2` reference). */
function seedAttemptB(order: { id: string; totalCents: number; orderNumber: string }) {
  return seedPayment(store, {
    orderId: order.id,
    customerReference: `${order.orderNumber}-R2`,
    status: "PROCESSING",
    amountCents: order.totalCents,
    providerTransactionId: "ws_CO_B",
    retryCount: 1,
    createdAt: new Date(Date.now() + 1000),
    metadata: { payhero: { reference: "PHREF-B" } },
  });
}

function successCallbackFor(order: { orderNumber: string; totalCents: number }, attempt: PaymentRow) {
  return callbackPayload({
    checkoutRequestId: attempt.providerTransactionId ?? "ws_CO_UNKNOWN",
    externalReference: attempt.customerReference,
    amount: order.totalCents / 100,
  });
}

const payments = () => [...store.tables.payments.values()];
const events = () => [...store.tables.paymentEvents.values()];
const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);
const notificationsOf = (type: string) =>
  [...store.tables.notifications.values()].filter((n) => n.type === type);
const notificationsTitled = (fragment: string) =>
  [...store.tables.notifications.values()].filter((n) => n.title.includes(fragment));

// ─── Invariant matrix ────────────────────────────────────────────────────────

describe("lifecycle — order state vs. payment initiation", () => {
  it("a PENDING order with zero attempts starts payment; a QUEUED push pays nothing yet", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client } = recordingStkClient();

    const result = await service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client });

    assert.equal(result.outcome, "initiated");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    const row = payments()[0]!;
    assert.equal(row.status, "PROCESSING");
    assert.equal(row.amountCents, order.totalCents, "amount is the order's, in cents");
  });

  it("a PAID order refuses a new initiation (already_paid)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    await transitions.markOrderPaid(db(), {
      orderId: order.id,
      confirmedTotalCents: order.totalCents,
      actor: { id: "test", source: "test-seed" },
    });

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: ACTOR_A,
        orderId: order.id,
        client: recordingStkClient().client,
      }),
      (error: unknown) => (error as { code?: string }).code === "already_paid"
    );
  });

  it("a CANCELLED order refuses a new initiation (not_payable)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    await transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: ACTOR_A,
        orderId: order.id,
        client: recordingStkClient().client,
      }),
      (error: unknown) => (error as { code?: string }).code === "not_payable"
    );
  });

  it("payment attempt cancellation (1032) is NOT order cancellation: order stays PENDING and a retry succeeds", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);

    // Buyer dismisses the STK prompt.
    const cancelled = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptA.providerTransactionId!,
        externalReference: attemptA.customerReference,
        statusWord: "Failed",
        resultCode: 1032,
        resultDesc: "Request cancelled by user",
        mpesaReceiptNumber: null,
      })
    );
    assert.deepEqual(cancelled, { kind: "processed", result: "CANCELLED" });
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "ORDER untouched");
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "CANCELLED");
    assert.equal(auditsOf("payment.cancelled").length, 1);
    assert.equal(auditsOf("payment.failed").length, 0, "not collapsed into a failure");
    assert.equal(auditsOf("order.cancelled").length, 0, "no order-level event");

    // The buyer retries — a NEW attempt, which is the one that collects.
    const { client, calls } = recordingStkClient();
    const retry = await service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client });
    assert.equal(retry.outcome, "initiated");
    const attemptB = payments().find((p) => p.id !== attemptA.id)!;
    assert.equal(attemptB.retryCount, 1);
    assert.equal(attemptB.customerReference, `${order.orderNumber}-R2`);
    assert.equal(calls.length, 1);

    const settled = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptB.providerTransactionId ?? calls[0]!.coId,
        externalReference: attemptB.customerReference,
        amount: order.totalCents / 100,
      })
    );
    assert.equal(settled.kind, "processed");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "CANCELLED", "history intact");
  });

  it("a failed attempt leaves the order PENDING and a retry can collect", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);

    const failed = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptA.providerTransactionId!,
        externalReference: attemptA.customerReference,
        statusWord: "Failed",
        resultCode: 2001,
        resultDesc: "The initiator information is invalid.",
        mpesaReceiptNumber: null,
      })
    );
    assert.deepEqual(failed, { kind: "processed", result: "FAILED" });
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.failed").length, 1);
    assert.equal(auditsOf("payment.cancelled").length, 0);

    const { client } = recordingStkClient();
    const retry = await service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client });
    assert.equal(retry.outcome, "initiated", "retry after failure is legitimate");
  });

  it("only an exact-amount success settles: low and high amounts both bounce", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    for (const [label, kes] of [
      ["too low", order.totalCents / 100 - 1],
      ["too high", order.totalCents / 100 + 1],
    ] as const) {
      const attempt = seedPayment(store, {
        orderId: order.id,
        customerReference: `${order.orderNumber}-R${label === "too low" ? 2 : 3}`,
        status: "PROCESSING",
        amountCents: order.totalCents,
        providerTransactionId: `ws_CO_AMT_${label}`,
      });
      const outcome = await callbacks.handlePayheroCallback(
        db(),
        callbackPayload({
          checkoutRequestId: attempt.providerTransactionId!,
          externalReference: attempt.customerReference,
          amount: kes,
        })
      );
      assert.equal(outcome.kind, "amount_mismatch", label);
      assert.equal(store.tables.payments.get(attempt.id)!.status, "PROCESSING", "nothing settled");
    }
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.amount_mismatch").length, 2);
    assert.equal(payments().filter((p) => p.status === "SUCCESS").length, 0);
  });
});

// ─── One effective successful payment per order ─────────────────────────────

describe("lifecycle — only one payment can settle an order", () => {
  it("sequential: B settles; a later success callback for stale attempt A is an audited no-op", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    const attemptB = seedAttemptB(order);

    // B's callback lands first and takes the order.
    const first = await callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptB));
    assert.equal(first.kind, "processed");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");

    // The stale success for A arrives afterwards (the buyer paid BOTH prompts).
    const stale = await callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptA));

    assert.deepEqual(stale, { kind: "ignored", reason: "order_already_settled" });
    assert.equal(
      store.tables.payments.get(attemptA.id)!.status,
      "PROCESSING",
      "A is NOT a second success; reconciliation owns what the provider really did"
    );
    assert.equal(store.tables.payments.get(attemptB.id)!.status, "SUCCESS");
    assert.equal(payments().filter((p) => p.status === "SUCCESS").length, 1);

    // One paid-order effect, one payment success audit, one anomaly.
    assert.equal(auditsOf("order.paid").length, 1);
    assert.equal(auditsOf("payment.success").length, 1);
    const anomalies = auditsOf("payment.anomaly");
    assert.equal(anomalies.length, 1);
    assert.equal(
      (anomalies[0]!.metadata as Record<string, unknown>).anomaly,
      "superseded_success"
    );

    // Both callbacks are in the event ledger: B processed, A recorded-but-ignored.
    const byId = new Map(events().map((e) => [e.providerEventId, e]));
    assert.equal(byId.get("stk-callback:ws_CO_B")!.processingStatus, "PROCESSED");
    assert.equal(byId.get("stk-callback:ws_CO_A")!.processingStatus, "IGNORED");
  });

  it("Race B: two success callbacks delivered concurrently settle exactly one payment", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    const attemptB = seedAttemptB(order);

    await Promise.all([
      callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptA)),
      callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptB)),
    ]);

    const settled = payments().filter((p) => p.status === "SUCCESS");
    assert.equal(settled.length, 1, "exactly one effective successful payment");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(auditsOf("order.paid").length, 1);
    assert.equal(auditsOf("payment.success").length, 1);
    const anomalies = auditsOf("payment.anomaly");
    assert.equal(anomalies.length, 1);
    assert.equal(
      (anomalies[0]!.metadata as Record<string, unknown>).anomaly,
      "superseded_success"
    );
    // The loser attempt stays non-terminal with its event recorded.
    const loser = payments().find((p) => p.status !== "SUCCESS")!;
    assert.equal(loser.status, "PROCESSING");
    assert.equal(events().length, 2);
    assert.equal(notificationsTitled("paid").length, 2, "buyer + seller, notified once");
  });

  it("verification of the stale attempt after the sibling settled reports superseded, unchanged", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    const attemptB = seedAttemptB(order);
    // B already settled the order.
    await callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptB));
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    const paidAuditsBefore = auditsOf("order.paid").length;

    // Ops checks A's status; PayHero confirms A's money... arrived too (the
    // buyer really did pay both prompts — a double collection to reconcile).
    const { client, lookedUp } = verificationClient({
      "PHREF-A": txStatus("SUCCESS", { providerReference: "RCP-A", checkoutRequestId: "ws_CO_A" }),
    });
    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: attemptA.id,
      client,
    });

    assert.deepEqual(result, { outcome: "superseded" });
    assert.deepEqual(lookedUp, ["PHREF-A"]);
    assert.equal(
      store.tables.payments.get(attemptA.id)!.status,
      "PROCESSING",
      "no second success recorded"
    );
    assert.equal(
      store.tables.payments.get(attemptA.id)!.providerReference,
      null,
      "no receipt metadata written by the superseded path"
    );
    assert.equal(auditsOf("order.paid").length, paidAuditsBefore);
    assert.equal(
      auditsOf("payment.anomaly").filter(
        (a) => (a.metadata as Record<string, unknown>).anomaly === "superseded_success"
      ).length,
      1
    );
  });
});

// ─── Payment/order cancellation races ───────────────────────────────────────

describe("lifecycle — payment vs order cancellation, composed with attempts", () => {
  it("cancel wins first: a late pair of success callbacks yields at most ONE successful payment, a kept CANCELLED order, and one inventory restoration", async () => {
    const product = seedListing(5, 100_000);
    const order = await placeOrder(BUYER_A, product.id, 2);
    const attemptA = seedAttemptA(order);
    const attemptB = seedAttemptB(order);

    await transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });
    assert.equal(store.tables.products.get(product.id)!.quantity, 5, "restored once by 9.1");

    const first = await callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptA));
    const second = await callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptB));

    // The FIRST arrival claims the payment-level truth (money really arrived);
    // the order stays cancelled and the anomaly is on the record.
    assert.equal(first.kind, "processed");
    if (first.kind === "processed" && first.result === "SUCCESS") {
      assert.equal(first.orderChanged, false);
      assert.equal(first.anomaly, "order_cancelled");
    } else {
      assert.fail(`unexpected first outcome ${JSON.stringify(first)}`);
    }
    assert.deepEqual(second, { kind: "ignored", reason: "order_already_settled" });

    assert.equal(store.tables.orders.get(order.id)!.status, "CANCELLED");
    assert.equal(payments().filter((p) => p.status === "SUCCESS").length, 1);
    assert.equal(
      store.tables.products.get(product.id)!.quantity,
      5,
      "no second inventory restoration, ever"
    );
    assert.equal(auditsOf("order.paid").length, 0);
    assert.equal(notificationsTitled("paid").length, 0, "no contradictory 'paid' notification");
    const anomalyKinds = auditsOf("payment.anomaly").map(
      (a) => (a.metadata as Record<string, unknown>).anomaly
    );
    assert.deepEqual([...anomalyKinds].sort(), ["order_cancelled", "superseded_success"]);
  });

  it("Race D: A+success vs B+success vs cancellation — one legal terminal outcome, no double effects", async () => {
    const product = seedListing(5, 100_000);
    const order = await placeOrder(BUYER_A, product.id, 2);
    const attemptA = seedAttemptA(order);
    const attemptB = seedAttemptB(order);

    const [outcomeA, outcomeB] = await Promise.all([
      callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptA)),
      callbacks.handlePayheroCallback(db(), successCallbackFor(order, attemptB)),
      // Cancellation enters mid-flight; either winner is legal.
      (async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return transitions
          .cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id })
          .catch((error: unknown) => error);
      })(),
    ]);
    void outcomeA;
    void outcomeB;

    const orderRow = store.tables.orders.get(order.id)!;
    const settledPayments = payments().filter((p) => p.status === "SUCCESS");

    // At most one effective success, whatever the winner.
    assert.ok(settledPayments.length <= 1, "never two successful payments");
    assert.ok(["PAID", "CANCELLED"].includes(orderRow.status), "one terminal order state");

    if (orderRow.status === "PAID") {
      // Payment won: exactly one success, one paid transition, stock stays sold.
      assert.equal(settledPayments.length, 1);
      assert.equal(auditsOf("order.paid").length, 1);
      assert.equal(store.tables.products.get(product.id)!.quantity, 3);
      assert.equal(notificationsTitled("paid").length, 2, "buyer + seller once");
    } else {
      // Cancellation won: stock restored exactly once, no paid signal.
      assert.equal(store.tables.products.get(product.id)!.quantity, 5);
      assert.equal(auditsOf("order.paid").length, 0);
      assert.equal(notificationsTitled("paid").length, 0);
      if (settledPayments.length === 1) {
        // Money arrived anyway: the anomaly ledger says so.
        const anomalyKinds = auditsOf("payment.anomaly").map(
          (a) => (a.metadata as Record<string, unknown>).anomaly
        );
        assert.ok(anomalyKinds.includes("order_cancelled"));
      }
    }
    assert.equal(auditsOf("payment.success").length, settledPayments.length);
    assert.equal(events().length, 2, "both deliveries recorded");
  });
});

// ─── Duplicate deliveries ───────────────────────────────────────────────────

describe("lifecycle — duplicate callback storms change nothing", () => {
  it("the SAME success callback ×3 concurrently: one event, one claim, one transition", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    const payload = successCallbackFor(order, attemptA);

    const outcomes = await Promise.all([
      callbacks.handlePayheroCallback(db(), payload),
      callbacks.handlePayheroCallback(db(), payload),
      callbacks.handlePayheroCallback(db(), payload),
    ]);

    const processed = outcomes.filter((o) => o.kind === "processed");
    const duplicates = outcomes.filter((o) => o.kind === "duplicate");
    assert.equal(processed.length, 1);
    assert.equal(duplicates.length, 2);

    assert.equal(payments().filter((p) => p.status === "SUCCESS").length, 1);
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(events().length, 1, "one provider event, however many deliveries");
    assert.equal(auditsOf("payment.success").length, 1);
    assert.equal(auditsOf("order.paid").length, 1);
    assert.equal(notificationsTitled("paid").length, 2, "buyer + seller, exactly once");
  });

  it("sequential duplicate success, then a duplicate failed callback claiming the same transaction: all harmless", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    const payload = successCallbackFor(order, attemptA);

    await callbacks.handlePayheroCallback(db(), payload);
    const dup = await callbacks.handlePayheroCallback(db(), payload);
    assert.equal(dup.kind, "duplicate");

    // A contradictory FAILED 'redelivery' still maps to the same provider
    // event id (same CheckoutRequestID) — it cannot rewrite the settlement.
    const failedTwin = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptA.providerTransactionId!,
        externalReference: attemptA.customerReference,
        statusWord: "Failed",
        resultCode: 1,
        mpesaReceiptNumber: null,
      })
    );
    assert.equal(failedTwin.kind, "duplicate");

    assert.equal(store.tables.payments.get(attemptA.id)!.status, "SUCCESS");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(events().length, 1);
    assert.equal(auditsOf("payment.failed").length, 0);
    assert.equal(auditsOf("payment.success").length, 1);
  });

  it("duplicate failed callbacks notify the buyer once", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    const failedPayload = callbackPayload({
      checkoutRequestId: attemptA.providerTransactionId!,
      externalReference: attemptA.customerReference,
      statusWord: "Failed",
      resultCode: 1,
      mpesaReceiptNumber: null,
    });

    const outcomes = await Promise.all([
      callbacks.handlePayheroCallback(db(), failedPayload),
      callbacks.handlePayheroCallback(db(), failedPayload),
    ]);
    assert.equal(
      outcomes.filter((o) => o.kind === "processed").length,
      1,
      "one recorded failure"
    );
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.failed").length, 1);
    assert.equal(notificationsOf("PAYMENT_UPDATE").length, 1);
  });
});

// ─── Crash-window recovery (payment SUCCESS, order not yet PAID) ────────────

describe("lifecycle — the two-step settle heals its crash window", () => {
  /** Simulate "claim committed, order transition never ran". */
  function seedSettledPaymentStuckOrder(order: { id: string; totalCents: number; orderNumber: string }) {
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "SUCCESS",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_A",
      paidAt: new Date(Date.now() - 60_000),
    });
    // The event row the original claim committed with the payment.
    store.tables.paymentEvents.set("evt-crash-window", {
      id: "evt-crash-window",
      paymentId: payment.id,
      provider: "PAYHERO",
      providerEventId: "stk-callback:ws_CO_A",
      eventType: "Success",
      payloadHash: "0".repeat(64),
      rawPayload: {},
      processingStatus: "PROCESSED",
      processedAt: new Date(Date.now() - 60_000),
      receivedAt: new Date(Date.now() - 61_000),
    });
    return payment;
  }

  it("a replayed callback recovers the order transition and stays a duplicate otherwise", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedSettledPaymentStuckOrder(order);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "the stuck state");

    const replay = await callbacks.handlePayheroCallback(
      db(),
      successCallbackFor(order, { providerTransactionId: "ws_CO_A", customerReference: order.orderNumber } as PaymentRow)
    );

    assert.deepEqual(replay, { kind: "duplicate" }, "still no double effect");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID", "crash window healed");
    assert.equal(auditsOf("order.paid").length, 1, "the recovered transition is audited once");
    assert.equal(auditsOf("payment.success").length, 0, "payment-level audit is NOT re-emitted");
    assert.equal(events().length, 1);
  });

  it("status verification on an already-SUCCESS payment recovers the order WITHOUT calling the provider", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedSettledPaymentStuckOrder(order);

    const { client, lookedUp } = verificationClient({});
    const result = await service.verifyPayheroPaymentStatus(db(), { paymentId: payment.id, client });

    assert.deepEqual(result, { outcome: "already_success" });
    assert.deepEqual(lookedUp, [], "a settled payment is never re-questioned at the provider");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID", "recovery ran anyway");
  });

  it("recovery on a cancelled order heals nothing and records nothing new", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedSettledPaymentStuckOrder(order);
    await transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });

    const { client } = verificationClient({});
    const result = await service.verifyPayheroPaymentStatus(db(), { paymentId: payment.id, client });

    assert.deepEqual(result, { outcome: "already_success" });
    assert.equal(store.tables.orders.get(order.id)!.status, "CANCELLED");
    assert.equal(auditsOf("payment.anomaly").length, 0, "silent: the original settle's audit stands");
    assert.equal(store.tables.products.get(product.id)!.quantity, 5, "no extra restoration");
  });
});

// ─── PROCESSING / abandoned attempts ────────────────────────────────────────

describe("lifecycle — PROCESSING is neither success nor failure", () => {
  it("an abandoned QUEUED attempt: re-joins instead of duplicating, verification stays pending, a later success settles normally", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, calls } = recordingStkClient();

    const first = await service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client });
    assert.equal(first.outcome, "initiated");

    // Buyer closes the app mid-prompt and comes back later: same money, same
    // attempt — never a second push.
    const rejoined = await service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client });
    assert.equal(rejoined.outcome, "already_initiated");
    assert.equal(calls.length, 1);

    const payment = payments()[0]!;
    assert.equal(payment.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "nothing settles while QUEUED");

    // Ops verifies against the provider: still queued on the phone.
    const meta = payment.metadata as { payhero?: { reference?: string } };
    const { client: verifyWith } = verificationClient({
      [meta.payhero?.reference ?? ""]: txStatus("QUEUED"),
    });
    const status = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id,
      client: verifyWith,
    });
    assert.deepEqual(status, { outcome: "still_pending" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");

    // The buyer eventually enters their PIN: the callback settles as designed.
    const settled = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: payment.providerTransactionId!,
        externalReference: payment.customerReference,
        amount: order.totalCents / 100,
      })
    );
    assert.equal(settled.kind, "processed");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("a stale PROCESSING attempt cannot settle a CANCELLED order — but a truthful failure still records on the attempt", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    await transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });

    // The phone still reports the prompt was dismissed.
    const outcome = await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptA.providerTransactionId!,
        externalReference: attemptA.customerReference,
        statusWord: "Failed",
        resultCode: 1032,
        resultDesc: "Request cancelled by user",
        mpesaReceiptNumber: null,
      })
    );
    assert.deepEqual(outcome, { kind: "processed", result: "CANCELLED" });
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "CANCELLED");
    assert.equal(store.tables.orders.get(order.id)!.status, "CANCELLED", "order untouched");
    assert.equal(store.tables.products.get(product.id)!.quantity, 5, "restored exactly once");
  });
});

// ─── Verification rules over every terminal shape (Invariant C / no downgrade) ─

describe("lifecycle — transaction-status verification honors terminal states", () => {
  it("provider FAILED on a live attempt fails the attempt only", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);

    const { client } = verificationClient({ "PHREF-A": txStatus("FAILED") });
    const result = await service.verifyPayheroPaymentStatus(db(), { paymentId: attemptA.id, client });

    assert.deepEqual(result, { outcome: "verified_failed", paymentApplied: true });
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "order remains payable");
    assert.equal(auditsOf("payment.failed").length, 1);
  });

  it("an already-FAILED attempt refuses resurrection even when the provider reports SUCCESS", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    // Locally terminal: an earlier callback recorded the failure.
    await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptA.providerTransactionId!,
        externalReference: attemptA.customerReference,
        statusWord: "Failed",
        resultCode: 1,
        mpesaReceiptNumber: null,
      })
    );

    const { client, lookedUp } = verificationClient({ "PHREF-A": txStatus("SUCCESS") });
    const result = await service.verifyPayheroPaymentStatus(db(), { paymentId: attemptA.id, client });

    assert.deepEqual(result, { outcome: "already_terminal", status: "FAILED" });
    assert.deepEqual(lookedUp, [], "terminal rows never reach the provider again");
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("an already-CANCELLED attempt refuses resurrection too", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);
    await callbacks.handlePayheroCallback(
      db(),
      callbackPayload({
        checkoutRequestId: attemptA.providerTransactionId!,
        externalReference: attemptA.customerReference,
        statusWord: "Failed",
        resultCode: 1032,
        mpesaReceiptNumber: null,
      })
    );

    const { client } = verificationClient({ "PHREF-A": txStatus("SUCCESS") });
    const result = await service.verifyPayheroPaymentStatus(db(), { paymentId: attemptA.id, client });
    assert.deepEqual(result, { outcome: "already_terminal", status: "CANCELLED" });
    assert.equal(store.tables.payments.get(attemptA.id)!.status, "CANCELLED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("verification settles a paid-but-unsettled attempt exactly like the callback would (canonical finalizer)", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const attemptA = seedAttemptA(order);

    const { client } = verificationClient({
      "PHREF-A": txStatus("SUCCESS", { providerReference: "RCP-VERIFY", checkoutRequestId: "ws_CO_A" }),
    });
    const result = await service.verifyPayheroPaymentStatus(db(), { paymentId: attemptA.id, client });

    if (result.outcome !== "verified_success") assert.fail(`unexpected ${JSON.stringify(result)}`);
    assert.equal(result.paymentApplied, true);
    assert.equal(result.orderChanged, true);
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(store.tables.payments.get(attemptA.id)!.providerReference, "RCP-VERIFY");
    assert.equal(auditsOf("payment.success").length, 1, "finalizer audits exactly like callback");
    assert.equal(auditsOf("order.paid").length, 1);
    assert.equal(notificationsTitled("paid").length, 2);
  });
});

// ─── Attempt cap (abuse control) ────────────────────────────────────────────

describe("lifecycle — payment attempts are bounded", () => {
  function seedTerminalAttempts(order: { id: string; totalCents: number; orderNumber: string }, count: number) {
    for (let i = 0; i < count; i += 1) {
      seedPayment(store, {
        orderId: order.id,
        customerReference: i === 0 ? order.orderNumber : `${order.orderNumber}-R${i + 1}`,
        status: i % 2 === 0 ? "FAILED" : "CANCELLED",
        amountCents: order.totalCents,
        providerTransactionId: `ws_CO_HIST_${i}`,
        retryCount: i,
        createdAt: new Date(Date.now() - (count - i) * 60_000),
      });
    }
  }

  it("the cap stops NEW attempt creation, while the order stays payable in every other respect", async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedTerminalAttempts(order, service.MAX_PAYMENT_ATTEMPTS_PER_ORDER);

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: ACTOR_A,
        orderId: order.id,
        client: recordingStkClient().client,
      }),
      (error: unknown) => (error as { code?: string }).code === "attempt_limit"
    );
    assert.equal(payments().length, service.MAX_PAYMENT_ATTEMPTS_PER_ORDER, "no new row reserved");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "order itself is fine");
  });

  it(`the cap never blocks joining or resuming the ACTIVE attempt`, async () => {
    const product = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedTerminalAttempts(order, service.MAX_PAYMENT_ATTEMPTS_PER_ORDER);
    const active = seedPayment(store, {
      orderId: order.id,
      customerReference: `${order.orderNumber}-R${service.MAX_PAYMENT_ATTEMPTS_PER_ORDER + 1}`,
      status: "PROCESSING",
      amountCents: order.totalCents,
      providerTransactionId: "ws_CO_ACTIVE",
      retryCount: service.MAX_PAYMENT_ATTEMPTS_PER_ORDER,
    });

    const rejoined = await service.initiatePayheroStk(db(), {
      actor: ACTOR_A,
      orderId: order.id,
      client: recordingStkClient().client,
    });
    assert.equal(rejoined.outcome, "already_initiated");
    assert.equal(rejoined.payment.id, active.id);
  });
});
