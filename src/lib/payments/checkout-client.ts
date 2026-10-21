import type {
  BuyerPaymentSnapshot,
  BuyerPaymentStatusSnapshot,
} from "@/lib/payments/payment-snapshot";

/**
 * Browser-side checkout/payment client — the ONLY place the checkout screens
 * talk to the network.
 *
 * ─── What a request may carry ───────────────────────────────────────────────
 * Exactly what the existing route handlers accept and nothing else:
 *
 *   POST /api/orders                        → delivery county/address only
 *   POST /api/payments/paystack/initialize  → `{ orderId }`
 *   GET  /api/payments/paystack/verify      → `?orderId=…`
 *   POST /api/payments/paystack/verify      → `{ orderId }`
 *
 * Amounts, prices, seller ids, buyer ids, provider/channel/callback details
 * and payment statuses are never sent — the server derives every one of them
 * from the order row, the session and server configuration, so there is
 * nothing here to tamper with. This module cannot move money by itself: it
 * can only ask the server to start a collection or to report one. A success
 * response from the Paystack checkout widget is NOT treated as proof of
 * payment anywhere in this module — only the server's own snapshot can
 * produce the paid state.
 *
 * ─── Error copy ────────────────────────────────────────────────────────────
 * The backend already returns safe, specific messages for domain states
 * ("This order has already been paid."), so those are preferred verbatim.
 * The provider-level failures are the exception: the server's text there
 * talks about deployment configuration, which is not useful (and slightly
 * leaky) in a buyer's screen, so a short user-facing sentence replaces it.
 * No message ever contains a stack, a token or a provider payload.
 */

export const CHECKOUT_PATH = "/checkout";
export const ORDERS_ENDPOINT = "/api/orders";
export const PAYSTACK_INITIALIZE_ENDPOINT = "/api/payments/paystack/initialize";
export const PAYMENT_STATUS_ENDPOINT = "/api/payments/paystack/verify";

/** How often the waiting screen asks the server, and for how long. */
export const PAYMENT_POLL_INTERVAL_MS = 6_000;
export const PAYMENT_POLL_WINDOW_MS = 120_000;

/**
 * The payment methods the checkout may offer.
 *
 * One entry today: Paystack-hosted checkout (mobile money). It is a list,
 * and the payment-method section renders it as one, so adding a provider
 * later is a data change plus its own server route — not a checkout rewrite.
 * Nothing here claims a method MaliHub cannot actually collect.
 */
export type PaymentMethodOption = {
  id: "paystack";
  label: string;
  description: string;
  /** The channel behind this option, for display and diagnostics only. */
  provider: "PAYSTACK";
  method: "MOBILE_MONEY";
  enabled: boolean;
};

export const PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  {
    id: "paystack",
    label: "Paystack",
    description: "Pay securely with M-Pesa mobile money through Paystack's hosted checkout.",
    provider: "PAYSTACK",
    method: "MOBILE_MONEY",
    enabled: true,
  },
];

/** The one method this build can collect with. */
export const PAYSTACK_METHOD = PAYMENT_METHODS[0]!;

/** The created-order shape `POST /api/orders` actually returns. */
export type CheckoutOrder = {
  id: string;
  orderNumber: string;
  sellerId: string;
  status: string;
  subtotalCents: number;
  totalCents: number;
};

/** Paystack InlineJS transaction details returned by the server. */
export type PaystackCheckoutResult = { accessCode: string; reference: string; reused: boolean };

export type ApiFailure = {
  ok: false;
  status: number;
  code?: string;
  message: string;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * Copy for the error codes the payment routes document. Only the provider
 * layer is rewritten; every other code falls through to the server's message,
 * which is already user-safe and more specific than anything hardcoded here
 * could be.
 */
const FRIENDLY_PROVIDER_ERRORS: Readonly<Record<string, string>> = {
  provider_not_configured: "Online payments are temporarily unavailable. Please try again later.",
  provider_unavailable: "We couldn't reach the payment service just now. Please try again in a moment.",
  provider_rejected: "The payment service couldn't process this payment. Please try again.",
  provider_invalid_response: "The payment service returned an unexpected response. Please try again.",
  provider_retired: "This payment needs to be checked by our support team. Please contact us with the order number.",
  attempt_limit: "Payment attempts for this order have reached the limit. Please try again later.",
  payment_initializing: "This payment is still being set up. Please wait a moment and check again.",
};

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** The sentence a buyer sees for a failed API call. */
export function mapPaymentError(code: string | undefined, serverMessage?: string): string {
  if (code && FRIENDLY_PROVIDER_ERRORS[code]) return FRIENDLY_PROVIDER_ERRORS[code]!;
  if (serverMessage && serverMessage.trim()) return serverMessage;
  return GENERIC_ERROR;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function failureFrom(
  response: Response,
  body: Record<string, unknown> | null,
  fallback: string
): ApiFailure {
  const code = typeof body?.code === "string" ? body.code : undefined;
  const serverMessage = typeof body?.error === "string" ? body.error : undefined;
  return {
    ok: false,
    status: response.status,
    ...(code ? { code } : {}),
    message: mapPaymentError(code, serverMessage ?? fallback),
  };
}

/**
 * `POST /api/orders` — creates the PENDING order(s) for the session's cart.
 *
 * The body is an empty object on purpose: prices, sellers and ownership are
 * server-derived, and the cart is a single-use token server-side (a doubled
 * request loses the claim and creates nothing twice).
 */
export async function createCheckoutOrders(delivery: {
  county: string;
  address: string;
}): Promise<ApiResult<CheckoutOrder[]>> {
  let response: Response;
  try {
    response = await fetch(ORDERS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryCounty: delivery.county,
        deliveryAddress: delivery.address,
      }),
    });
  } catch {
    return { ok: false, status: 0, message: "We couldn't reach the server. Please try again." };
  }

  const body = await readJson(response);
  if (!response.ok || body?.success !== true) {
    return failureFrom(response, body, "We couldn't create your order. Please try again.");
  }

  const data = body.data as { orders?: CheckoutOrder[] } | undefined;
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  if (orders.length === 0) {
    return {
      ok: false,
      status: response.status,
      message: "We couldn't create your order. Please try again.",
    };
  }
  return { ok: true, data: orders };
}

/**
 * `POST /api/payments/paystack/initialize` — initializes a Paystack
 * transaction for one of the caller's own PENDING orders.
 *
 * A 200 here means the checkout was created — it is NOT a completed payment;
 * callers must wait for the status endpoint (or the server's webhook) to
 * confirm. The secret key stays on the server; the browser receives only an
 * access code it hands to Paystack's hosted checkout.
 */
export async function initiatePaystackCheckout(orderId: string): Promise<ApiResult<PaystackCheckoutResult>> {
  let response: Response;
  try {
    response = await fetch(PAYSTACK_INITIALIZE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
  } catch {
    return { ok: false, status: 0, message: "We couldn't reach the server. Please try again." };
  }
  const body = await readJson(response);
  if (!response.ok || body?.success !== true) {
    return failureFrom(response, body, "We couldn't start Paystack checkout. Please try again.");
  }
  const data = body.data as PaystackCheckoutResult | undefined;
  if (!data?.accessCode || typeof data.accessCode !== "string" || !data.reference) {
    return { ok: false, status: response.status, message: "Paystack returned invalid checkout details." };
  }
  return { ok: true, data };
}

/**
 * The caller's own payment status.
 *
 * `verify: false` (GET) is a pure database read. `verify: true` (POST) asks
 * the server to reconcile a waiting attempt against Paystack first — the
 * recovery path when a webhook is late — and is the one that may settle the
 * payment. Both are ownership-scoped server-side; a foreign order id is 404.
 */
export async function fetchPaymentStatus(
  orderId: string,
  options: { verify?: boolean } = {}
): Promise<ApiResult<BuyerPaymentStatusSnapshot>> {
  const verify = options.verify ?? false;

  let response: Response;
  try {
    response = verify
      ? await fetch(PAYMENT_STATUS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        })
      : await fetch(`${PAYMENT_STATUS_ENDPOINT}?orderId=${encodeURIComponent(orderId)}`, {
          method: "GET",
        });
  } catch {
    return { ok: false, status: 0, message: "We couldn't reach the server. Please try again." };
  }

  const body = await readJson(response);
  if (!response.ok || body?.success !== true) {
    return failureFrom(response, body, "We couldn't check the payment status. Please try again.");
  }

  const data = body.data as BuyerPaymentStatusSnapshot | undefined;
  if (!data?.order) {
    return {
      ok: false,
      status: response.status,
      message: "We couldn't check the payment status. Please try again.",
    };
  }
  return { ok: true, data };
}

/**
 * Single-flight guard, used around order creation: while a call is in flight,
 * a second invocation (double click, impatient tap, retry while pending)
 * joins the same promise instead of issuing a second request.
 *
 * The server also refuses a second checkout of the same cart, so this is a UX
 * guard rather than the safety mechanism — but it keeps the accidental double
 * POST from leaving the browser in the first place.
 */
export function createSerializedTask<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = task().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

/**
 * The payment phase implied by a server snapshot — the pure rule the payment
 * UI is built on, kept here so it can be tested without a DOM.
 *
 * The critical property: an in-flight attempt maps to "awaiting", never to
 * "succeeded". Success requires the server to say so (payment SUCCESS or a
 * paid order status) — the checkout initiation response can never produce it.
 */
export type PaymentPhase = "idle" | "initiating" | "awaiting" | "succeeded" | "failed";

export function paymentPhaseFromSnapshot(snapshot: BuyerPaymentSnapshot | null): PaymentPhase {
  if (!snapshot) return "idle";
  if (snapshot.order.status === "PAID") return "succeeded";
  if (snapshot.payment?.status === "SUCCESS") return "succeeded";
  if (
    snapshot.payment &&
    (snapshot.payment.status === "FAILED" || snapshot.payment.status === "CANCELLED")
  ) {
    return "failed";
  }
  if (snapshot.order.status !== "PENDING") return "failed";
  if (snapshot.awaitingConfirmation) return "awaiting";
  return "idle";
}

/**
 * The next order in a multi-seller checkout that still needs paying, or null
 * when every order is settled (`succeeded`).
 */
export function firstUnpaidOrderId(
  orders: readonly { id: string }[],
  phases: Readonly<Record<string, string | undefined>>
): string | null {
  return orders.find((order) => phases[order.id] !== "succeeded")?.id ?? null;
}

/** Human label for the last attempt's status (the UI shows it as state). */
export function paymentAttemptLabel(snapshot: BuyerPaymentSnapshot | null): string {
  if (!snapshot?.payment) return "Not started";
  switch (snapshot.payment.status) {
    case "PENDING":
      return "Starting";
    case "PROCESSING":
      return "Awaiting payment confirmation";
    case "SUCCESS":
      return "Paid";
    case "FAILED":
      return "Payment failed";
    case "CANCELLED":
      return "Payment cancelled";
    case "REFUNDED":
      return "Refunded";
    default:
      return snapshot.payment.status;
  }
}
