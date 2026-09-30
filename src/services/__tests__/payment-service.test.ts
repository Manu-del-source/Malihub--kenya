import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type {
  PayheroClient,
  PayheroClientError as PayheroClientErrorType,
  PayheroStkPushParams,
  PayheroStkPushResult,
} from "@/lib/payments/payhero";

mock.module("server-only", { namedExports: {} });

/**
 * `initiatePayheroStk` and `verifyPayheroPaymentStatus` against the in-memory
 * marketplace store, with the PayHero HTTP boundary replaced by a stubbed
 * client. The invariants under test:
 *
 *   1. The amount, channel, provider and callback URL are NEVER client input
 *      — the payment row is built from the order row, the provider call from
 *      server config.
 *   2. "QUEUED" is not money: a successful STK push leaves the payment
 *      PROCESSING and the order PENDING.
 *   3. Initiation is idempotent: a double click joins the existing attempt; a
 *      crash before the provider answer resumes the same row with the same
 *      reference; a failed attempt retires and a retry makes a NEW row.
 *   4. Status verification trusts the provider only through the same
 *      conditional claims the callback uses — and can never downgrade a
 *      locally settled payment.
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
let PayheroClientError: typeof import("@/lib/payments/payhero").PayheroClientError;

const BUYER_A = "buyer-a";
const BUYER_B = "buyer-b";
const SELLER_1 = "seller-1";

const ACTOR_A = { userId: BUYER_A, email: "buyer-a@example.com", accountPhone: "0712345678" };
const CONFIG_ENV = {
  PAYHERO_AUTH_TOKEN: "test-token",
  PAYHERO_CHANNEL_ID: "133",
  PAYHERO_CALLBACK_URL: "https://malihub.example.com/api/payments/payhero/callback",
};

before(async () => {
  service = await import("@/services/payment-service");
  ({ PayheroClientError } = await import("@/lib/payments/payhero"));
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

// ─── Stub PayHero client ─────────────────────────────────────────────────────

type StkScript =
  | { kind: "success"; reference?: string; checkoutRequestId?: string; status?: string }
  | { kind: "error"; error: Error };

function stubClient(script: {
  stk?: StkScript;
  status?:
    | { kind: "success"; status: string; providerReference?: string | null; checkoutRequestId?: string | null }
    | { kind: "error"; error: Error };
}) {
  const stkCalls: PayheroStkPushParams[] = [];
  const statusCalls: string[] = [];
  const client: PayheroClient = {
    async initiateStkPush(params: PayheroStkPushParams): Promise<PayheroStkPushResult> {
      stkCalls.push(params);
      const stk = script.stk ?? { kind: "success" as const };
      if (stk.kind === "error") throw stk.error;
      return {
        reference: stk.reference ?? "PHREF-1",
        checkoutRequestId: stk.checkoutRequestId ?? "ws_CO_TEST_1",
        status: stk.status ?? "QUEUED",
      };
    },
    async getTransactionStatus(reference: string) {
      statusCalls.push(reference);
      const status = script.status ?? { kind: "success" as const, status: "QUEUED" };
      if (status.kind === "error") throw status.error;
      const knownStatus = ["QUEUED", "SUCCESS", "FAILED"].includes(status.status);
      return {
        status: (knownStatus ? status.status : "QUEUED") as "QUEUED" | "SUCCESS" | "FAILED",
        knownStatus,
        rawStatus: status.status,
        providerReference: status.providerReference ?? null,
        checkoutRequestId: status.checkoutRequestId ?? null,
      };
    },
  };
  return { client, stkCalls, statusCalls };
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

const payments = () => [...store.tables.payments.values()];
const paymentByRef = (ref: string) =>
  payments().find((p) => p.customerReference === ref);
const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);

// ─── Initiation ─────────────────────────────────────────────────────────────

describe("initiatePayheroStk — guards", () => {
  it("rejects an order that does not exist", async () => {
    const { client, stkCalls } = stubClient({});
    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: ACTOR_A,
        orderId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        client,
        env: CONFIG_ENV,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "not_found");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0, "PayHero must not be called");
  });

  it("rejects an order belonging to a different buyer, identically to a missing one", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, stkCalls } = stubClient({});

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: { userId: BUYER_B, email: "buyer-b@example.com", accountPhone: "0712345678" },
        orderId: order.id,
        client,
        env: CONFIG_ENV,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "not_found");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0);
    assert.equal(payments().length, 0);
  });

  it("rejects an order that is not payable (CANCELLED)", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const transitions = await import("@/services/order-transition-service");
    await transitions.cancelOrder(db(), { actorUserId: BUYER_A, orderId: order.id });

    const { client, stkCalls } = stubClient({});
    await assert.rejects(
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "not_payable");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0);
    assert.equal(payments().length, 0);
  });

  it("rejects an already-PAID order without calling the provider", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const transitions = await import("@/services/order-transition-service");
    await transitions.markOrderPaid(db(), {
      orderId: order.id,
      actor: { id: "someone", source: "test" },
    });

    const { client, stkCalls } = stubClient({});
    await assert.rejects(
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "already_paid");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0);
  });

  it("refuses an order total that cannot be expressed in whole KES", async () => {
    const { product } = seedListing(5, 150_050); // KES 1500.50 — not whole KES
    const order = await placeOrder(BUYER_A, product.id, 1);
    const { client, stkCalls } = stubClient({});

    await assert.rejects(
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "invalid_amount");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0);
    assert.equal(payments().length, 0, "no payment row for an uncollectable amount");
  });

  it("requires a phone number when neither request nor account provides one", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, stkCalls } = stubClient({});

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: { userId: BUYER_A, email: ACTOR_A.email, accountPhone: null },
        orderId: order.id,
        client,
        env: CONFIG_ENV,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "phone_required");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0);
  });

  it("rejects a malformed phone number", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, stkCalls } = stubClient({});

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: ACTOR_A,
        orderId: order.id,
        phoneNumber: "12345",
        client,
        env: CONFIG_ENV,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "phone_invalid");
        return true;
      }
    );
    assert.equal(stkCalls.length, 0);
  });

  it("fails clearly when PayHero is not configured", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    await assert.rejects(
      service.initiatePayheroStk(db(), {
        actor: ACTOR_A,
        orderId: order.id,
        env: {}, // no client injected, no env: the production resolution path
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "provider_not_configured");
        return true;
      }
    );
    assert.equal(payments().length, 0);
  });
});

describe("initiatePayheroStk — happy path", () => {
  it("creates the payment, pushes STK with authoritative values and claims the initiation", async () => {
    const { product } = seedListing(5, 100_000); // KES 1000 a unit
    const order = await placeOrder(BUYER_A, product.id, 2); // KES 2000
    const { client, stkCalls } = stubClient({
      stk: { kind: "success", reference: "PHREF-9", checkoutRequestId: "ws_CO_9" },
    });

    const result = await service.initiatePayheroStk(db(), {
      actor: ACTOR_A,
      orderId: order.id,
      client,
      env: CONFIG_ENV,
    });

    assert.equal(result.outcome, "initiated");
    assert.equal(stkCalls.length, 1);

    // The STK call: amount from the ORDER, phone normalized, reference ours.
    const call = stkCalls[0]!;
    assert.equal(call.amountKes, 2_000, "amount comes from Order.totalCents");
    assert.equal(call.phoneNumber, "254712345678", "0712345678 normalized to MSISDN");
    assert.equal(call.externalReference, order.orderNumber);
    assert.equal(call.customerName, "Emmanuel Yegon");

    // The Payment row reflects exactly that, and the PayHero identifiers are
    // persisted: CheckoutRequestID on the row, PayHero reference in metadata.
    const payment = paymentByRef(order.orderNumber)!;
    assert.equal(payment.orderId, order.id);
    assert.equal(payment.provider, "PAYHERO");
    assert.equal(payment.method, "MOBILE_MONEY");
    assert.equal(payment.status, "PROCESSING");
    assert.equal(payment.amountCents, order.totalCents);
    assert.equal(payment.payerReference, "254712345678");
    assert.equal(payment.providerTransactionId, "ws_CO_9");
    assert.equal((payment.metadata as { payhero: { reference?: string } }).payhero.reference, "PHREF-9");

    // QUEUED is not a collected payment: the order stays PENDING.
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(payment.paidAt, null);

    // The audit breadcrumb carries amounts and references, never the phone.
    const audits = auditsOf("payment.initiated");
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.actorId, BUYER_A);
    assert.equal(audits[0]!.targetId, payment.id);
    assert.equal(JSON.stringify(audits[0]!.metadata).includes("254712345678"), false);
  });

  it("uses the request phone when supplied, normalized the same way", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, stkCalls } = stubClient({});

    await service.initiatePayheroStk(db(), {
      actor: ACTOR_A,
      orderId: order.id,
      phoneNumber: "+254787677676",
      client,
      env: CONFIG_ENV,
    });

    assert.equal(stkCalls[0]!.phoneNumber, "254787677676");
  });

  it("a double submission re-joins the live attempt instead of re-pushing STK", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, stkCalls } = stubClient({});

    const first = await service.initiatePayheroStk(db(), {
      actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV,
    });
    const second = await service.initiatePayheroStk(db(), {
      actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV,
    });

    assert.equal(first.outcome, "initiated");
    assert.equal(second.outcome, "already_initiated");
    assert.equal(stkCalls.length, 1, "exactly one STK push for one order");
    assert.equal(payments().length, 1, "exactly one payment row");
  });

  it("two CONCURRENT initiations race to one payment row and one STK push", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client, stkCalls } = stubClient({});

    const [first, second] = await Promise.all([
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV }),
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV }),
    ]);

    const rows = payments();
    assert.equal(rows.length, 1, "the advisory lock serialized the two initiations");
    assert.equal(stkCalls.length, 1, "exactly one STK push reached the provider");
    const outcomes = [first.outcome, second.outcome].sort();
    assert.deepEqual(outcomes, ["already_initiated", "initiated"]);
    assert.equal(first.payment.id, second.payment.id);
  });

  it("resumes the SAME row when the provider call previously died after reservation", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    // First attempt: the provider is unreachable between reservation and claim.
    const dead = stubClient({ stk: { kind: "error", error: new PayheroClientError("network", "down") } });
    await assert.rejects(
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client: dead.client, env: CONFIG_ENV })
    );
    assert.equal(payments().length, 1);
    assert.equal(payments()[0]!.status, "PENDING");
    assert.equal(payments()[0]!.providerTransactionId, null);

    // Second attempt: provider back — the same row and reference are reused.
    const alive = stubClient({ stk: { kind: "success", checkoutRequestId: "ws_CO_BACK" } });
    const result = await service.initiatePayheroStk(db(), {
      actor: ACTOR_A, orderId: order.id, client: alive.client, env: CONFIG_ENV,
    });

    assert.equal(result.outcome, "initiated");
    assert.equal(payments().length, 1, "recovery must not fork a second payment row");
    const payment = payments()[0]!;
    assert.equal(payment.providerTransactionId, "ws_CO_BACK");
    assert.equal(payment.customerReference, order.orderNumber, "reference is stable across the resume");
    assert.equal(alive.stkCalls[0]!.externalReference, order.orderNumber);
  });

  it("a retry after a provider-reported failure creates a NEW attempt with a new reference", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);

    seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "FAILED",
      retryCount: 0,
      providerTransactionId: "ws_CO_OLD",
      amountCents: order.totalCents,
    });

    const { client, stkCalls } = stubClient({});
    const result = await service.initiatePayheroStk(db(), {
      actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV,
    });

    assert.equal(result.outcome, "initiated");
    const rows = payments();
    assert.equal(rows.length, 2);
    const attempt = rows.find((row) => row.retryCount === 1)!;
    assert.equal(attempt.customerReference, `${order.orderNumber}-R2`);
    assert.equal(stkCalls[0]!.externalReference, `${order.orderNumber}-R2`);
    // The failed attempt is immutable history, per the schema's attempt model.
    assert.equal(rows.find((row) => row.retryCount === 0)!.status, "FAILED");
  });
});

describe("initiatePayheroStk — provider failure mapping", () => {
  async function expectMapping(error: PayheroClientErrorType, code: string) {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const { client } = stubClient({ stk: { kind: "error", error } });

    await assert.rejects(
      service.initiatePayheroStk(db(), { actor: ACTOR_A, orderId: order.id, client, env: CONFIG_ENV }),
      (thrown: unknown) => {
        assert.equal((thrown as { code?: string }).code, code, `for ${error.kind}`);
        return true;
      }
    );
    // The attempt survives PENDING/unclaimed so a later call can resume it.
    const rows = payments();
    assert.equal(rows.length, 1, `for ${error.kind}`);
    assert.equal(rows[0]!.status, "PENDING");
    assert.equal(rows[0]!.providerTransactionId, null);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  }

  it("maps a PayHero 4xx to provider_rejected", async () => {
    await expectMapping(new PayheroClientError("http_rejected", "refused", 400), "provider_rejected");
  });

  it("maps a well-formed refusal to provider_rejected", async () => {
    await expectMapping(new PayheroClientError("declined", "declined"), "provider_rejected");
  });

  it("maps a PayHero 5xx to provider_unavailable", async () => {
    await expectMapping(new PayheroClientError("http_error", "server error", 502), "provider_unavailable");
  });

  it("maps a network failure to provider_unavailable", async () => {
    await expectMapping(new PayheroClientError("network", "down"), "provider_unavailable");
  });

  it("maps a timeout to provider_unavailable", async () => {
    await expectMapping(new PayheroClientError("timeout", "slow"), "provider_unavailable");
  });

  it("maps a malformed response to provider_invalid_response", async () => {
    await expectMapping(new PayheroClientError("invalid_response", "weird"), "provider_invalid_response");
  });
});

// ─── Status verification ─────────────────────────────────────────────────────

describe("verifyPayheroPaymentStatus", () => {
  async function seedProcessingAttempt(orderId: string, orderNumber: string, totalCents: number) {
    return seedPayment(store, {
      orderId,
      customerReference: orderNumber,
      status: "PROCESSING",
      amountCents: totalCents,
      providerTransactionId: "ws_CO_VERIFY",
      metadata: { payhero: { reference: "PHREF-VERIFY" } },
    });
  }

  it("a provider SUCCESS settles the payment AND marks the order paid", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = await seedProcessingAttempt(order.id, order.orderNumber, order.totalCents);
    const { client, statusCalls } = stubClient({
      status: { kind: "success", status: "SUCCESS", providerReference: "SAE3YULR0Y" },
    });

    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id,
      client,
      env: CONFIG_ENV,
    });

    assert.deepEqual(statusCalls, ["PHREF-VERIFY"], "looks up by the initiation reference");
    assert.equal(result.outcome, "verified_success");
    if (result.outcome === "verified_success") {
      assert.equal(result.paymentApplied, true);
      assert.equal(result.orderChanged, true);
    }
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.providerReference, "SAE3YULR0Y");
    assert.ok(row.paidAt instanceof Date);
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
  });

  it("a provider QUEUED changes nothing", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = await seedProcessingAttempt(order.id, order.orderNumber, order.totalCents);
    const { client } = stubClient({ status: { kind: "success", status: "QUEUED" } });

    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id, client, env: CONFIG_ENV,
    });

    assert.equal(result.outcome, "still_pending");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("a provider FAILED marks the payment failed and leaves the order unpaid", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = await seedProcessingAttempt(order.id, order.orderNumber, order.totalCents);
    const { client } = stubClient({ status: { kind: "success", status: "FAILED" } });

    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id, client, env: CONFIG_ENV,
    });

    assert.equal(result.outcome, "verified_failed");
    if (result.outcome === "verified_failed") assert.equal(result.paymentApplied, true);
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.failed").length, 1);
  });

  it("an undocumented provider status is reported, never guessed", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = await seedProcessingAttempt(order.id, order.orderNumber, order.totalCents);
    const { client } = stubClient({ status: { kind: "success", status: "PENDING_REVIEW" } });

    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id, client, env: CONFIG_ENV,
    });

    assert.deepEqual(result, { outcome: "unknown_status", rawStatus: "PENDING_REVIEW" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
  });

  it("a locally settled payment is NEVER downgraded by a stale provider answer", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "SUCCESS",
      amountCents: order.totalCents,
      paidAt: new Date(),
    });
    const { client, statusCalls } = stubClient({ status: { kind: "success", status: "FAILED" } });

    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id, client, env: CONFIG_ENV,
    });

    assert.equal(result.outcome, "already_success");
    assert.equal(statusCalls.length, 0, "no provider round-trip is even made");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
  });

  it("a locally terminal-failed payment is not resurrected by a provider SUCCESS", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "FAILED",
      amountCents: order.totalCents,
    });
    const { client } = stubClient({ status: { kind: "success", status: "SUCCESS" } });

    const result = await service.verifyPayheroPaymentStatus(db(), {
      paymentId: payment.id, client, env: CONFIG_ENV,
    });

    assert.deepEqual(result, { outcome: "already_terminal", status: "FAILED" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("maps provider-call failures to service errors without touching state", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = await seedProcessingAttempt(order.id, order.orderNumber, order.totalCents);

    for (const [clientError, code] of [
      [new PayheroClientError("http_error", "down", 500), "provider_unavailable"],
      [new PayheroClientError("timeout", "slow"), "provider_unavailable"],
      [new PayheroClientError("invalid_response", "weird"), "provider_invalid_response"],
    ] as const) {
      const { client } = stubClient({ status: { kind: "error", error: clientError } });
      await assert.rejects(
        service.verifyPayheroPaymentStatus(db(), { paymentId: payment.id, client, env: CONFIG_ENV }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, code);
          return true;
        }
      );
      assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    }
  });

  it("refuses to verify a payment that has no provider reference yet", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: order.orderNumber,
      status: "PENDING", // reserved, but the provider call never completed
      amountCents: order.totalCents,
      metadata: { payhero: {} },
    });
    const { client, statusCalls } = stubClient({});

    await assert.rejects(
      service.verifyPayheroPaymentStatus(db(), { paymentId: payment.id, client, env: CONFIG_ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "provider_rejected");
        return true;
      }
    );
    assert.equal(statusCalls.length, 0);
  });
});
