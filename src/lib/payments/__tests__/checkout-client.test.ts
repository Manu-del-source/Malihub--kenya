import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CHECKOUT_PATH,
  createCheckoutOrders,
  createSerializedTask,
  fetchPaymentStatus,
  firstUnpaidOrderId,
  initiateStkPayment,
  mapPaymentError,
  MPESA_METHOD,
  ORDERS_ENDPOINT,
  PAYMENT_METHODS,
  PAYMENT_STATUS_ENDPOINT,
  paymentPhaseFromSnapshot,
  STK_ENDPOINT,
  validateMpesaPhone,
} from "@/lib/payments/checkout-client";
import type { BuyerPaymentSnapshot } from "@/lib/payments/payment-snapshot";

/**
 * The browser-side checkout/payment contract.
 *
 * Everything the checkout screen sends is defined in one module
 * (`checkout-client.ts`); this suite pins the two things that matter most:
 *
 *  1. **Request shape** — the browser sends exactly what the existing route
 *     handlers accept (`{}` to create orders, `{ orderId, phoneNumber }` to
 *     start an STK push) and nothing else. No amount, no price, no buyer or
 *     seller id, no provider settings.
 *  2. **State honesty** — a QUEUED STK response is never treated as success;
 *     only the server's own snapshot can produce the paid state.
 */

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[];
let responder: (url: string, init: RequestInit) => { status?: number; body: unknown };
const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  responder = () => ({ status: 200, body: { success: true } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const answer = responder(String(input), init ?? {});
    return jsonResponse(answer.status ?? 200, answer.body);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const BUYER_PHONE = "0712345678";

function snapshot(overrides: Partial<BuyerPaymentSnapshot> = {}): BuyerPaymentSnapshot {
  return {
    order: { id: "order-1", orderNumber: "MH-ABC12345", status: "PENDING", totalCents: 200_000 },
    payment: null,
    attempts: { used: 0, max: 5, remaining: 5 },
    payable: true,
    awaitingConfirmation: false,
    canInitiate: true,
    ...overrides,
  };
}

describe("payment methods — only what the backend can actually collect", () => {
  it("offers M-Pesa through PayHero and nothing else", () => {
    assert.equal(CHECKOUT_PATH, "/checkout");
    assert.equal(PAYMENT_METHODS.length, 1);
    assert.equal(MPESA_METHOD.id, "mpesa");
    assert.equal(MPESA_METHOD.label, "M-Pesa");
    assert.equal(MPESA_METHOD.provider, "PAYHERO");
    assert.equal(MPESA_METHOD.method, "MOBILE_MONEY");
    assert.equal(MPESA_METHOD.requiresPhone, true);
    assert.equal(MPESA_METHOD.enabled, true);

    const advertised = JSON.stringify(PAYMENT_METHODS).toLowerCase();
    for (const unsupported of ["airtel", "paypal", "card", "bank transfer", "stripe"]) {
      assert.equal(
        advertised.includes(unsupported),
        false,
        `checkout must not advertise unsupported rail: ${unsupported}`
      );
    }
  });
});

describe("phone validation — the same Kenyan rule the server enforces", () => {
  it("accepts every common valid format", () => {
    for (const value of ["0712345678", "0112345678", "+254712345678", "254712345678"]) {
      assert.equal(validateMpesaPhone(value), null, `${value} should be valid`);
    }
  });

  it("rejects invalid numbers, separators and empty input with a clear message", () => {
    for (const value of ["00", "12345", "071234567", "0812345678", "25471", "0712 345 678"]) {
      const error = validateMpesaPhone(value);
      assert.ok(error, `${value} should be rejected`);
      assert.match(error!, /valid Kenyan M-Pesa number/i);
    }
    for (const empty of ["", "   "]) {
      assert.match(validateMpesaPhone(empty)!, /enter the m-pesa phone number/i);
    }
  });
});

describe("error mapping — safe, friendly, no internals", () => {
  it("replaces provider-level backend text with buyer-facing copy", () => {
    assert.equal(
      mapPaymentError("provider_not_configured", "Card/mobile-money collection is not configured on this deployment."),
      "Mobile payments are temporarily unavailable. Please try again later."
    );
    assert.equal(
      mapPaymentError("attempt_limit", "This order has reached the maximum number of payment attempts."),
      "Payment attempts for this order have reached the limit. Please try again later."
    );
  });

  it("prefers the backend's own domain messages (they are specific and safe)", () => {
    assert.equal(mapPaymentError("already_paid", "This order has already been paid."), "This order has already been paid.");
    assert.equal(mapPaymentError("phone_invalid", "Enter a valid Kenyan phone number, e.g. 0712345678"), "Enter a valid Kenyan phone number, e.g. 0712345678");
    assert.equal(mapPaymentError(undefined, undefined), "Something went wrong. Please try again.");
  });

  it("never surfaces provider secrets or internals in any mapped message", () => {
    const codes = [
      "provider_not_configured",
      "provider_rejected",
      "provider_unavailable",
      "provider_invalid_response",
      "phone_required",
      "phone_invalid",
      "not_found",
      "not_payable",
      "already_paid",
      "attempt_limit",
      "rate_limited",
    ];
    for (const code of codes) {
      const message = mapPaymentError(code, "internal provider text");
      assert.equal(/token|channel_id|callback_url|payhero_auth|stack|Error:/i.test(message), false, code);
    }
  });
});

describe("POST /api/orders — server-authoritative order creation", () => {
  it("sends an empty body and reads the created orders from the response", async () => {
    responder = () => ({
      status: 201,
      body: {
        success: true,
        data: {
          orders: [
            { id: "o1", orderNumber: "MH-1", sellerId: "s1", status: "PENDING", subtotalCents: 100_000, totalCents: 100_000 },
            { id: "o2", orderNumber: "MH-2", sellerId: "s2", status: "PENDING", subtotalCents: 50_000, totalCents: 50_000 },
          ],
        },
      },
    });

    const result = await createCheckoutOrders();

    assert.equal(calls[0]!.url, ORDERS_ENDPOINT);
    assert.equal(calls[0]!.init.method, "POST");
    assert.deepEqual(bodyOf(calls[0]!), {}, "prices, ids and totals are never sent");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.length, 2, "multi-seller checkout returns one order per seller");
      assert.equal(result.data[0]!.id, "o1");
      assert.equal(result.data[1]!.id, "o2");
    }
  });

  it("maps an empty-cart refusal to the server's message and creates no STK call", async () => {
    responder = () => ({
      status: 400,
      body: { success: false, error: "Your cart is empty.", code: "empty_cart" },
    });

    const result = await createCheckoutOrders();

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Your cart is empty.");
      assert.equal(result.code, "empty_cart");
    }
    assert.equal(calls.length, 1);
  });

  it("handles an unavailable network without throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    const result = await createCheckoutOrders();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /reach the server/i);
  });
});

describe("POST /api/payments/payhero/stk — exactly two fields, never a success claim", () => {
  it("sends only orderId and phoneNumber", async () => {
    responder = () => ({
      status: 200,
      body: {
        success: true,
        data: {
          paymentReference: "MH-ABC12345",
          checkoutRequestId: "ws_CO_1",
          paymentStatus: "PROCESSING",
          amountCents: 200_000,
          alreadyInitiated: false,
          providerStatus: "QUEUED",
        },
      },
    });

    const result = await initiateStkPayment("order-1", BUYER_PHONE);

    assert.equal(calls[0]!.url, STK_ENDPOINT);
    const sent = bodyOf(calls[0]!);
    assert.deepEqual(Object.keys(sent).sort(), ["orderId", "phoneNumber"]);
    assert.equal(sent.orderId, "order-1");
    assert.equal(sent.phoneNumber, BUYER_PHONE);
    for (const forbidden of [
      "amount",
      "amountCents",
      "total",
      "totalCents",
      "price",
      "currency",
      "buyerId",
      "sellerId",
      "channelId",
      "channel_id",
      "callbackUrl",
      "callback_url",
      "provider",
      "paymentStatus",
    ]) {
      assert.equal(forbidden in sent, false, `client must not send ${forbidden}`);
    }

    // The response says QUEUED / PROCESSING — never "paid".
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.providerStatus, "QUEUED");
      assert.equal(result.data.paymentStatus, "PROCESSING");
    }
  });

  it("maps a provider_not_configured refusal to friendly copy", async () => {
    responder = () => ({
      status: 503,
      body: {
        success: false,
        error: "Card/mobile-money collection is not configured on this deployment.",
        code: "provider_not_configured",
      },
    });

    const result = await initiateStkPayment("order-1", BUYER_PHONE);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Mobile payments are temporarily unavailable. Please try again later.");
      assert.equal(result.code, "provider_not_configured");
    }
  });
});

describe("payment status — reads are cheap, verification is explicit", () => {
  it("GETs a plain read and POSTs when verification is requested", async () => {
    responder = () => ({ status: 200, body: { success: true, data: snapshot() } });

    await fetchPaymentStatus("order-1");
    assert.equal(calls[0]!.init.method, "GET");
    assert.match(calls[0]!.url, new RegExp(`^${PAYMENT_STATUS_ENDPOINT}\\?orderId=order-1`));
    assert.equal(calls[0]!.init.body, undefined);

    await fetchPaymentStatus("order-1", { verify: true });
    assert.equal(calls[1]!.init.method, "POST");
    assert.deepEqual(bodyOf(calls[1]!), { orderId: "order-1" });
  });

  it("returns the server snapshot and its ownership refusal verbatim", async () => {
    responder = () => ({ status: 200, body: { success: true, data: snapshot({ awaitingConfirmation: true }) } });
    const ok = await fetchPaymentStatus("order-1");
    assert.equal(ok.ok, true);

    responder = () => ({ status: 404, body: { success: false, error: "Order not found." } });
    const missing = await fetchPaymentStatus("order-1", { verify: true });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.message, "Order not found.");
  });
});

describe("state honesty — a queued STK is never success", () => {
  it("maps PROCESSING/PENDING attempts to 'awaiting' and only server success to 'succeeded'", () => {
    assert.equal(paymentPhaseFromSnapshot(null), "idle");

    const processing = snapshot({
      awaitingConfirmation: true,
      payment: {
        id: "p1",
        status: "PROCESSING",
        amountCents: 200_000,
        customerReference: "MH-ABC12345",
        providerTransactionId: "ws_CO_1",
        providerReference: null,
        retryCount: 0,
        createdAt: new Date().toISOString(),
        paidAt: null,
        failureCode: null,
        failureReason: null,
      },
    });
    assert.equal(paymentPhaseFromSnapshot(processing), "awaiting");

    const paid = snapshot({
      order: { id: "order-1", orderNumber: "MH-ABC12345", status: "PAID", totalCents: 200_000 },
      payment: { ...processing.payment!, status: "SUCCESS", providerReference: "RCPT1", paidAt: new Date().toISOString() },
    });
    assert.equal(paymentPhaseFromSnapshot(paid), "succeeded");

    const failed = snapshot({ payment: { ...processing.payment!, status: "FAILED" } });
    assert.equal(paymentPhaseFromSnapshot(failed), "failed");

    const cancelled = snapshot({ payment: { ...processing.payment!, status: "CANCELLED" } });
    assert.equal(paymentPhaseFromSnapshot(cancelled), "failed");
  });
});

describe("duplicate safety and multi-seller sequencing", () => {
  it("coalesces concurrent clicks into one order-creation call", async () => {
    let created = 0;
    responder = () => {
      created += 1;
      return {
        status: 201,
        body: {
          success: true,
          data: {
            orders: [
              { id: "o1", orderNumber: "MH-1", sellerId: "s1", status: "PENDING", subtotalCents: 1, totalCents: 1 },
            ],
          },
        },
      };
    };

    const once = createSerializedTask(createCheckoutOrders);
    const [first, second] = await Promise.all([once(), once()]);

    assert.equal(calls.length, 1, "a double click must not create a second order");
    assert.equal(created, 1);
    assert.equal(first.ok && second.ok, true);

    await once();
    assert.equal(calls.length, 2, "after settling, a deliberate retry runs again");
  });

  it("walks a multi-seller checkout one order at a time", async () => {
    const orders = [{ id: "o1" }, { id: "o2" }];
    assert.equal(firstUnpaidOrderId(orders, {}), "o1");
    assert.equal(firstUnpaidOrderId(orders, { o1: "succeeded" }), "o2");
    assert.equal(firstUnpaidOrderId(orders, { o1: "succeeded", o2: "succeeded" }), null);
    assert.equal(firstUnpaidOrderId([], {}), null);
  });
});
