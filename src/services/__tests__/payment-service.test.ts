import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Explicit zero-rate fixture; no production/default delivery price is implied.
process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":0}';
const TEST_DELIVERY = { county: "Nairobi", address: "Moi Avenue", acceptedFeeCents: 0, acceptedSellerCount: 1 };

mock.module("server-only", { namedExports: {} });

/**
 * `payment-service.ts` — the provider-neutral settlement primitives that BOTH
 * trusted success channels (the signed Paystack webhook and the buyer's
 * status verification) funnel into, plus the post-commit fan-out helpers.
 *
 * The invariants under test:
 *   1. A success claim is CONDITIONAL: a payment that is already terminal
 *      cannot be moved again, and the row's identifiers are only written by
 *      the claim that wins.
 *   2. One effective successful payment per order: a sibling attempt that
 *      already carries SUCCESS supersedes a late success (no second effect).
 *   3. The order transition is two steps: the claim commits first, the
 *      `PENDING → PAID` transition runs second, is idempotent on replay, and
 *      surfaces anomalies (cancelled order, mismatched amount) instead of
 *      resurrecting state.
 *   4. Audits: exactly one `payment.success` per claim, one `payment.anomaly`
 *      per anomaly, one `payment.failed`/`payment.cancelled` per terminal
 *      non-collection.
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

let service: typeof import("@/services/payment-service");

const BUYER_A = "buyer-a";
const SELLER_1 = "seller-1";

const SYS = "00000000-0000-0000-0000-000000000000";

before(async () => {
  service = await import("@/services/payment-service");
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

const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);

// ─── claimPaymentSuccess ─────────────────────────────────────────────────────

describe("claimPaymentSuccess — the conditional success claim", () => {
  async function seedAttempt(status: "PENDING" | "PROCESSING" | "FAILED" | "SUCCESS") {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status,
      amountCents: order.totalCents,
    });
    return { order, payment };
  }

  it("claims a PENDING payment, stamps identifiers and the verbatim payload", async () => {
    const { order, payment } = await seedAttempt("PENDING");
    const rawPayload = { event: "charge.success", data: { id: 48213, reference: payment.customerReference } };

    const claim = await store.$transaction((tx) =>
      service.claimPaymentSuccess(
        tx as never,
        { ...payment, providerTransactionId: null, metadata: { paystack: { accessCode: "ac-1" } } },
        { providerReference: payment.customerReference, providerTransactionId: "48213" },
        rawPayload
      )
    );

    assert.equal(claim, "claimed");
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.ok(row.paidAt instanceof Date);
    assert.equal(row.providerReference, payment.customerReference);
    assert.equal(row.providerTransactionId, "48213");
    assert.deepEqual(row.rawCallbackPayload, rawPayload);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "the claim does not move the order itself");
  });

  it("claims a PROCESSING payment the same way", async () => {
    const { payment } = await seedAttempt("PROCESSING");
    const claim = await store.$transaction((tx) =>
      service.claimPaymentSuccess(tx as never, payment, {}, undefined)
    );
    assert.equal(claim, "claimed");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
  });

  it("a replay of an already-SUCCESS payment is effect-free (no identifier overwrite)", async () => {
    const { payment } = await seedAttempt("SUCCESS");
    const rowBefore = store.tables.payments.get(payment.id)!;
    assert.equal(rowBefore.providerReference, null);

    const claim = await store.$transaction((tx) =>
      service.claimPaymentSuccess(
        tx as never,
        payment,
        { providerReference: "MUST-NOT-LAND" },
        { event: "charge.success", data: { replay: true } }
      )
    );

    assert.equal(claim, "already_success");
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.providerReference, null, "a replay cannot rewrite the winner's identifiers");
    assert.equal(row.rawCallbackPayload, null, "a replay cannot overwrite the winner's payload");
  });

  it("a contradictory late success on a FAILED payment is refused", async () => {
    const { order, payment } = await seedAttempt("FAILED");
    const claim = await store.$transaction((tx) =>
      service.claimPaymentSuccess(tx as never, payment, {}, undefined)
    );
    assert.equal(claim, "already_terminal_other");
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("a sibling attempt that already settled the order supersedes a late success", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const winner = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-WINNER-${order.id.slice(0, 4)}`,
      status: "SUCCESS",
      amountCents: order.totalCents,
      paidAt: new Date(),
    });
    const loser = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-LOSER-${order.id.slice(0, 4)}`,
      status: "PROCESSING",
      amountCents: order.totalCents,
      retryCount: 1,
    });

    const claim = await store.$transaction((tx) =>
      service.claimPaymentSuccess(tx as never, loser, {}, undefined)
    );

    assert.equal(claim, "superseded");
    assert.equal(store.tables.payments.get(loser.id)!.status, "PROCESSING", "the loser is left untouched");
    assert.equal(store.tables.payments.get(winner.id)!.status, "SUCCESS");
  });

  it("runs under the order-keyed advisory lock", async () => {
    const { payment } = await seedAttempt("PENDING");
    const before = store.operations.filter((op) => op === "$executeRaw").length;
    await store.$transaction((tx) => service.claimPaymentSuccess(tx as never, payment, {}, undefined));
    const after = store.operations.filter((op) => op === "$executeRaw").length;
    assert.ok(after > before, "the claim must acquire the order-scoped advisory lock");
  });
});

// ─── claimPaymentFailure ─────────────────────────────────────────────────────

describe("claimPaymentFailure — terminal non-collection", () => {
  it("claims PENDING → FAILED with the failure detail", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "PENDING",
      amountCents: order.totalCents,
    });

    const claim = await store.$transaction((tx) =>
      service.claimPaymentFailure(
        tx as never,
        payment,
        { to: "FAILED", code: "charge.failed", reason: 'Paystack reported status "failed".' },
        { event: "charge.failed" }
      )
    );

    assert.equal(claim, "claimed");
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "FAILED");
    assert.equal(row.failureCode, "charge.failed");
    assert.equal(row.failureReason, 'Paystack reported status "failed".');
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "a failed attempt leaves the order payable");
  });

  it("claims PROCESSING → CANCELLED", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "PROCESSING",
      amountCents: order.totalCents,
    });

    const claim = await store.$transaction((tx) =>
      service.claimPaymentFailure(tx as never, payment, { to: "CANCELLED", code: null, reason: null }, undefined)
    );

    assert.equal(claim, "claimed");
    assert.equal(store.tables.payments.get(payment.id)!.status, "CANCELLED");
  });

  it("never resurrects a terminal payment", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "FAILED",
      amountCents: order.totalCents,
    });

    const claim = await store.$transaction((tx) =>
      service.claimPaymentFailure(tx as never, payment, { to: "CANCELLED", code: null, reason: null }, undefined)
    );

    assert.equal(claim, "already_terminal");
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
  });

  it("loses the same-row race honestly (row changed under the caller)", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "PROCESSING",
      amountCents: order.totalCents,
    });
    // A concurrent terminal write landed between the caller's read and its
    // conditional update — the fake's updateMany matches on current state.
    store.tables.payments.get(payment.id)!.status = "SUCCESS";

    const claim = await store.$transaction((tx) =>
      service.claimPaymentFailure(tx as never, payment, { to: "FAILED", code: null, reason: null }, undefined)
    );

    assert.equal(claim, "already_terminal");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
  });
});

// ─── markOrderPaidForPayment ─────────────────────────────────────────────────

describe("markOrderPaidForPayment — step two, idempotent and anomaly-honest", () => {
  it("moves PENDING → PAID exactly once", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "SUCCESS",
      amountCents: order.totalCents,
    });

    const first = await service.markOrderPaidForPayment(db(), payment, "test");
    assert.equal(first.orderChanged, true);
    assert.equal(first.orderStatus, "PAID");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");

    const replay = await service.markOrderPaidForPayment(db(), payment, "test-replay");
    assert.equal(replay.orderChanged, false);
    assert.equal(replay.orderStatus, "PAID");
  });

  it("reports a cancelled order as an anomaly, never resurrecting it", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { cancelOrder } = await import("@/services/order-transition-service");
    await cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });

    const outcome = await service.markOrderPaidForPayment(
      db(),
      { orderId: order.id, amountCents: order.totalCents },
      "test"
    );

    assert.equal(outcome.orderChanged, false);
    assert.equal(outcome.anomaly, "order_cancelled");
    assert.equal(store.tables.orders.get(order.id)!.status, "CANCELLED");
  });

  it("reports a missing order as an anomaly instead of throwing", async () => {
    const outcome = await service.markOrderPaidForPayment(
      db(),
      { orderId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", amountCents: 100 },
      "test"
    );
    assert.equal(outcome.anomaly, "order_not_found");
  });

  it("refuses a confirmed amount that disagrees with the order total", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    const outcome = await service.markOrderPaidForPayment(
      db(),
      { orderId: order.id, amountCents: order.totalCents + 1 },
      "test"
    );

    assert.equal(outcome.anomaly, "amount_mismatch");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── settleSuccessfulPayment ─────────────────────────────────────────────────

describe("settleSuccessfulPayment — the canonical post-claim completion", () => {
  async function settledPayment() {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "SUCCESS",
      amountCents: order.totalCents,
    });
    return { order, payment };
  }

  it("emits exactly one payment.success audit for the claim that settled", async () => {
    const { payment } = await settledPayment();

    const first = await service.settleSuccessfulPayment(db(), payment, {
      source: "test",
      claimedNow: true,
    });
    assert.equal(first.orderChanged, true);
    assert.equal(first.successAudited, true);
    assert.equal(auditsOf("payment.success").length, 1);
    assert.equal(auditsOf("order.paid").length, 1, "the order transition recorded its own audit");

    // A recovery/replay: the order is already PAID and this call did not
    // claim — no second audit of any kind.
    const replay = await service.settleSuccessfulPayment(db(), payment, {
      source: "test-replay",
      claimedNow: false,
    });
    assert.equal(replay.orderChanged, false);
    assert.equal(replay.successAudited, false);
    assert.equal(auditsOf("payment.success").length, 1);
    assert.equal(auditsOf("order.paid").length, 1);
  });

  it("audits an anomaly instead of a silent success", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { cancelOrder } = await import("@/services/order-transition-service");
    await cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status: "SUCCESS",
      amountCents: order.totalCents,
    });

    const outcome = await service.settleSuccessfulPayment(db(), payment, {
      source: "test",
      claimedNow: true,
    });

    assert.equal(outcome.orderChanged, false);
    assert.equal(outcome.anomaly, "order_cancelled");
    assert.equal(auditsOf("payment.anomaly").length, 1);
    const anomaly = auditsOf("payment.anomaly")[0]!;
    assert.equal((anomaly.metadata as { anomaly?: string }).anomaly, "order_cancelled");
  });
});

// ─── afterPaymentFailureRecorded ─────────────────────────────────────────────

describe("afterPaymentFailureRecorded — fan-out that cannot roll the ledger back", () => {
  async function failedOrder(status: "FAILED" | "CANCELLED") {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      status,
      amountCents: order.totalCents,
    });
    return { order, payment };
  }

  it("audits payment.failed and notifies the buyer for a failed attempt", async () => {
    const { order, payment } = await failedOrder("FAILED");
    await service.afterPaymentFailureRecorded(db(), payment, "test", "FAILED");

    assert.equal(auditsOf("payment.failed").length, 1);
    assert.equal(auditsOf("payment.cancelled").length, 0);
    const notes = [...store.tables.notifications.values()];
    assert.ok(notes.some((n) => n.userId === BUYER_A));
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("keeps payment.cancelled distinct from payment.failed", async () => {
    const { payment } = await failedOrder("CANCELLED");
    await service.afterPaymentFailureRecorded(db(), payment, "test", "CANCELLED");

    assert.equal(auditsOf("payment.cancelled").length, 1);
    assert.equal(auditsOf("payment.failed").length, 0);
    const note = [...store.tables.notifications.values()].find((n) => n.userId === BUYER_A)!;
    assert.match(String(note.body), /cancelled/i);
  });
});

// ─── helpers & constants ─────────────────────────────────────────────────────

describe("mergeProviderMetadata", () => {
  it("shallow-merges a patch into the provider namespace and keeps siblings", () => {
    const existing = {
      paystack: { accessCode: "ac-1", initialization: "accepted" },
      other: { keep: true },
    };
    const next = service.mergeProviderMetadata(existing, "paystack", { providerReference: "MH-REF" });

    assert.deepEqual(next, {
      paystack: { accessCode: "ac-1", initialization: "accepted", providerReference: "MH-REF" },
      other: { keep: true },
    });
    // The input object was not mutated.
    const inputSection = (existing as { paystack: Record<string, unknown> }).paystack;
    assert.equal("providerReference" in inputSection, false);
  });

  it("tolerates null, array and scalar bases", () => {
    assert.deepEqual(service.mergeProviderMetadata(null, "paystack", { a: 1 }), { paystack: { a: 1 } });
    assert.deepEqual(service.mergeProviderMetadata([1, 2], "paystack", { a: 1 }), { paystack: { a: 1 } });
    assert.deepEqual(service.mergeProviderMetadata("weird", "paystack", { a: 1 }), { paystack: { a: 1 } });
    assert.deepEqual(
      service.mergeProviderMetadata({ paystack: "not-an-object" }, "paystack", { a: 1 }),
      { paystack: { a: 1 } }
    );
  });
});

describe("isUniqueViolation", () => {
  it("recognises Prisma P2002 and nothing else", () => {
    assert.equal(service.isUniqueViolation({ code: "P2002" }), true);
    assert.equal(service.isUniqueViolation({ code: "P2025" }), false);
    assert.equal(service.isUniqueViolation(new Error("P2002")), false);
    assert.equal(service.isUniqueViolation(null), false);
    assert.equal(service.isUniqueViolation(undefined), false);
  });
});

describe("service constants", () => {
  it("the system actor is the nil UUID (a valid actor_id that is never a user)", () => {
    assert.match(service.PAYMENT_SYSTEM_ACTOR_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(service.PAYMENT_SYSTEM_ACTOR_ID, SYS);
  });

  it("the attempt cap is a small hard bound", () => {
    assert.equal(service.MAX_PAYMENT_ATTEMPTS_PER_ORDER, 5);
  });

  it("PaymentServiceError carries a stable code", () => {
    const error = new service.PaymentServiceError("Nope", "provider_retired");
    assert.equal(error.code, "provider_retired");
    assert.equal(error.name, "PaymentServiceError");
  });
});
