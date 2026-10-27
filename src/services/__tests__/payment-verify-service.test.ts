import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Explicit zero-rate fixture; no production/default delivery price is implied.
process.env.MALIHUB_DELIVERY_COUNTY_RATES_JSON = '{"Nairobi":0}';
const TEST_DELIVERY = { county: "Nairobi", address: "Moi Avenue", acceptedFeeCents: 0, acceptedSellerCount: 1 };

mock.module("server-only", { namedExports: {} });

/**
 * `verifyPaystackPaymentStatus` — the buyer-reachable settlement channel and
 * the recovery path for "the webhook never arrived". The suite pins the two
 * inviolable rules (settled money is never re-asked; non-success answers go
 * through the same conditional claims as the webhook) plus the corroboration
 * checks that stop a successful-looking provider answer from settling the
 * wrong money.
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

let service: typeof import("@/services/payment-verify-service");
let PaystackClientErrorCtor: typeof import("@/lib/payments/paystack").PaystackClientError;
type PaystackClientType = import("@/lib/payments/paystack").PaystackClient;

const ENV = {
  PAYSTACK_SECRET_KEY: "sk_test_verifytestkey0001",
  PAYSTACK_CALLBACK_URL: "https://malihub.example.com/checkout",
};

const BUYER_A = "buyer-a";
const SELLER_1 = "seller-1";
const AMOUNT = 200_000;

before(async () => {
  service = await import("@/services/payment-verify-service");
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
      throw new Error("verify never initializes");
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

function seedAttempt(
  orderId: string,
  reference: string,
  totalCents: number,
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" = "PROCESSING",
  overrides: Record<string, unknown> = {}
) {
  return seedPayment(store, {
    orderId,
    customerReference: reference,
    provider: "PAYSTACK",
    status,
    amountCents: totalCents,
    currency: "KES",
    metadata: { paystack: { providerReference: reference, initialization: "accepted" } },
    ...overrides,
  });
}

const auditsOf = (action: string) =>
  [...store.tables.auditLogs.values()].filter((a) => a.action === action);

// ─── The inviolable rules ────────────────────────────────────────────────────

describe("settled money is never re-asked", () => {
  it("a locally-SUCCESS payment answers without a provider round-trip", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents, "SUCCESS");
    const { client, calls } = stubClient({
      ok: { status: "failed", reference: payment.customerReference, amount: AMOUNT, currency: "KES" },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), {
      paymentId: payment.id,
      client,
      env: ENV,
    });

    assert.deepEqual(result, { outcome: "already_success" });
    assert.equal(calls.length, 0, "the provider is never asked about settled money");
    assert.equal(store.tables.payments.get(payment.id)!.status, "SUCCESS");
  });

  it("…and still closes the order-transition crash window first", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents, "SUCCESS");
    // The claim committed, the order transition never ran.
    store.tables.orders.get(order.id)!.status = "PENDING";

    const result = await service.verifyPaystackPaymentStatus(db(), {
      paymentId: payment.id,
      client: stubClient({}).client,
      env: ENV,
    });

    assert.deepEqual(result, { outcome: "already_success" });
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID", "recovery re-ran the idempotent transition");
  });

  it("a locally-FAILED payment is not resurrected by a provider SUCCESS", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents, "FAILED");
    const { client, calls } = stubClient({});

    const result = await service.verifyPaystackPaymentStatus(db(), {
      paymentId: payment.id,
      client,
      env: ENV,
    });

    assert.deepEqual(result, { outcome: "already_terminal", status: "FAILED" });
    assert.equal(calls.length, 0);
    assert.equal(store.tables.payments.get(payment.id)!.status, "FAILED");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

describe("provider scope", () => {
  it("refuses to verify a retired-provider (PAYHERO) row and never fakes it through Paystack", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedPayment(store, {
      orderId: order.id,
      customerReference: `MH-${order.id.slice(0, 8)}`,
      provider: "PAYHERO",
      status: "PROCESSING",
      amountCents: order.totalCents,
      metadata: { payhero: { reference: "PH-LEGACY" } },
    });
    const { client, calls } = stubClient({});

    await assert.rejects(
      service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "provider_retired");
        return true;
      }
    );
    assert.equal(calls.length, 0, "the retired row must not be asked of the live provider");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
  });
});

// ─── Non-success provider answers ────────────────────────────────────────────

describe("non-success provider answers", () => {
  it("pending/default leave the attempt waiting", async () => {
    for (const raw of ["pending", "default"]) {
      const { product } = seedListing();
      const order = await placeOrder(BUYER_A, product.id);
      const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
      const { client } = stubClient({
        ok: { status: raw, reference: payment.customerReference, amount: AMOUNT, currency: "KES" },
      });

      const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

      assert.deepEqual(result, { outcome: "still_pending" }, `for ${raw}`);
      assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
      assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    }
  });

  it("a provider failure marks the attempt FAILED through the shared claim, leaves the order payable, and notifies", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client } = stubClient({
      ok: { status: "failed", reference: payment.customerReference, amount: AMOUNT, currency: "KES" },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

    assert.deepEqual(result, { outcome: "verified_failed", paymentApplied: true });
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "FAILED");
    assert.match(String(row.failureReason), /failed/);
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", "the order stays payable for a retry");
    assert.equal(auditsOf("payment.failed").length, 1);
    assert.ok([...store.tables.notifications.values()].some((n) => n.userId === BUYER_A));
  });

  it("does not release a failure observed while initialization is still in flight", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents, "PENDING", {
      metadata: { paystack: { initialization: "pending" } },
    });
    const { client } = stubClient({ ok: {
      status: "failed", reference: payment.customerReference, amount: order.totalCents, currency: "KES",
    } });
    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });
    assert.equal(result.outcome, "still_pending");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PENDING");
  });

  it("retains unknown and nonterminal provider states without releasing an attempt", async () => {
    for (const raw of ["ongoing", "processing", "queued", "unexpected-provider-state"]) {
      const { product } = seedListing();
      const order = await placeOrder(BUYER_A, product.id);
      const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
      const { client } = stubClient({
        ok: { status: raw, reference: payment.customerReference, amount: order.totalCents, currency: "KES" },
      });
      const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });
      assert.equal(result.outcome, raw === "unexpected-provider-state" ? "unknown_status" : "still_pending");
      assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING", raw);
      assert.equal(store.tables.orders.get(order.id)!.status, "PENDING", raw);
    }
  });

  it("requires a matching environment, reference, amount and currency before recording a provider failure", async () => {
    for (const mismatch of ["environment", "reference", "amount", "currency"] as const) {
      const { product } = seedListing();
      const order = await placeOrder(BUYER_A, product.id);
      const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
      const { client } = stubClient({ ok: {
        status: "failed",
        reference: mismatch === "reference" ? "MH-WRONG" : payment.customerReference,
        amount: mismatch === "amount" ? order.totalCents + 1 : order.totalCents,
        currency: mismatch === "currency" ? "NGN" : "KES",
        domain: mismatch === "environment" ? "live" : "test",
      } });
      const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });
      assert.deepEqual(result, { outcome: "verification_mismatch", detail: mismatch });
      assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
      assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    }
  });

  it("an abandoned transaction stays locked because its checkout may still be payable", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client } = stubClient({
      ok: { status: "abandoned", reference: payment.customerReference, amount: AMOUNT, currency: "KES" },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

    assert.deepEqual(result, { outcome: "still_pending" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });
});

// ─── Success — corroborated, not assumed ─────────────────────────────────────

describe("success answers are corroborated against our row", () => {
  it("a matching success settles the payment AND the order", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client, calls } = stubClient({
      ok: { status: "success", reference: payment.customerReference, amount: order.totalCents, currency: "KES", id: 48_213 },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

    assert.equal(result.outcome, "verified_success");
    if (result.outcome !== "verified_success") throw new Error("unreachable");
    assert.equal(result.paymentApplied, true);
    assert.equal(result.orderChanged, true);
    assert.deepEqual(calls, [payment.customerReference]);
    const row = store.tables.payments.get(payment.id)!;
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.providerReference, payment.customerReference);
    assert.equal(row.providerTransactionId, "48213");
    assert.equal(store.tables.orders.get(order.id)!.status, "PAID");
    assert.equal(auditsOf("payment.success").length, 1);
  });

  it("an already-settled success answers verified with paymentApplied=false", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    store.tables.orders.get(order.id)!.status = "PAID";
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents, "SUCCESS");

    const result = await service.verifyPaystackPaymentStatus(db(), {
      paymentId: payment.id,
      client: stubClient({}).client,
      env: ENV,
    });

    assert.deepEqual(result, { outcome: "already_success" });
    assert.equal(auditsOf("payment.success").length, 0, "the original settlement owns the audit");
  });

  it("a success for the WRONG reference is a mismatch, not a settlement", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client } = stubClient({
      ok: { status: "success", reference: "MH-SOMEONE-ELSE", amount: order.totalCents, currency: "KES" },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

    assert.deepEqual(result, { outcome: "verification_mismatch", detail: "reference" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.verification_mismatch").length, 1);
  });

  it("a success for the WRONG amount is a mismatch, in either direction", async () => {
    for (const wrong of [AMOUNT - 1, AMOUNT + 1]) {
      const { product } = seedListing();
      const order = await placeOrder(BUYER_A, product.id);
      const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
      const { client } = stubClient({
        ok: { status: "success", reference: payment.customerReference, amount: wrong, currency: "KES" },
      });

      const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

      assert.deepEqual(result, { outcome: "verification_mismatch", detail: "amount" }, `for ${wrong}`);
      assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
      assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    }
  });

  it("a success in the WRONG currency is a mismatch", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client } = stubClient({
      ok: { status: "success", reference: payment.customerReference, amount: AMOUNT, currency: "NGN" },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV });

    assert.deepEqual(result, { outcome: "verification_mismatch", detail: "currency" });
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("a success that supersedes a settled sibling is flagged, not applied", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    seedAttempt(order.id, `MH-WINNER-${order.id.slice(0, 4)}`, order.totalCents, "SUCCESS");
    const loser = seedAttempt(order.id, `MH-LOSER-${order.id.slice(0, 4)}`, order.totalCents);
    store.tables.orders.get(order.id)!.status = "PAID";
    const { client } = stubClient({
      ok: { status: "success", reference: loser.customerReference, amount: order.totalCents, currency: "KES" },
    });

    const result = await service.verifyPaystackPaymentStatus(db(), { paymentId: loser.id, client, env: ENV });

    assert.deepEqual(result, { outcome: "superseded" });
    assert.equal(store.tables.payments.get(loser.id)!.status, "PROCESSING", "no second effect on the losing attempt");
    assert.equal(auditsOf("payment.anomaly").length, 1);
    assert.equal((auditsOf("payment.anomaly")[0]!.metadata as { anomaly?: string }).anomaly, "superseded_success");
  });
});

// ─── Provider reachability is honest ─────────────────────────────────────────

describe("provider reachability", () => {
  it("an unknown reference (both candidates) is a provider refusal, state untouched", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents, "PROCESSING", {
      metadata: { paystack: { providerReference: "MH-ECHO-REF", initialization: "accepted" } },
    });
    const { client, calls } = stubClient({
      error: new PaystackClientErrorCtor("Paystack did not accept the request.", "rejected", 404),
    });

    await assert.rejects(
      service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "provider_rejected");
        return true;
      }
    );
    assert.deepEqual(calls, [payment.customerReference, "MH-ECHO-REF"], "both known references were tried");
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
  });

  it("a network failure is provider_unavailable and never a failed payment", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);
    const { client } = stubClient({ error: new PaystackClientErrorCtor("down", "unavailable") });

    await assert.rejects(
      service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, client, env: ENV }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "provider_unavailable");
        return true;
      }
    );
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
    assert.equal(store.tables.orders.get(order.id)!.status, "PENDING");
    assert.equal(auditsOf("payment.failed").length, 0, "we could not ask — that is not a failure");
  });

  it("an unconfigured deployment fails clearly without touching state", async () => {
    const { product } = seedListing();
    const order = await placeOrder(BUYER_A, product.id);
    const payment = seedAttempt(order.id, `MH-${order.id.slice(0, 8)}`, order.totalCents);

    await assert.rejects(
      service.verifyPaystackPaymentStatus(db(), { paymentId: payment.id, env: {} }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "provider_not_configured");
        return true;
      }
    );
    assert.equal(store.tables.payments.get(payment.id)!.status, "PROCESSING");
  });
});
