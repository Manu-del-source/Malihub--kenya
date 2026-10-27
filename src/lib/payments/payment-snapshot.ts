import type { OrderStatus, PaymentStatus } from "@prisma/client";

/**
 * The payment snapshot the buyer-facing UI consumes.
 *
 * ─── Why this is not in the payment service ─────────────────────────────────
 * `payment-service.ts` is `server-only`; a client component cannot import it.
 * The *shape* of what the checkout and order screens read, however, is shared
 * knowledge, so it lives here — type-only Prisma imports (erased at build)
 * plus pure helpers, safe to import from both a Server Component and a client
 * component. The server builds these values in
 * `src/services/payment-status-service.ts`; the client only ever consumes
 * them. Nothing here decides a transition or trusts a client value.
 *
 * The snapshot deliberately carries NO payer phone number, no provider
 * metadata blob and no raw payload: the UI does not need them, and a
 * response body is a place PII leaks from.
 */

/** One attempt (Payment row), reduced to what a buyer may see about it. */
export type BuyerPaymentAttempt = {
  id: string;
  status: PaymentStatus;
  /** The processor that handled (or attempted) this payment. */
  provider: string;
  amountCents: number;
  /** Our reference (order number, `-R{n}` on retries). Safe to display. */
  customerReference: string;
  /** Provider checkout id — not a secret, but only shown as a reference. */
  providerTransactionId: string | null;
  /** The settlement reference the buyer can quote (Paystack reference). */
  providerReference: string | null;
  retryCount: number;
  createdAt: string;
  paidAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
};

export type BuyerPaymentSnapshot = {
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalCents: number;
  };
  /** Relevant attempt: success or unresolved first, otherwise newest; null if none. */
  payment: BuyerPaymentAttempt | null;
  attempts: {
    used: number;
    max: number;
    remaining: number;
  };
  /** The pending order has an accepted delivery fee and no recorded successful payment. */
  payable: boolean;
  /** An attempt is waiting on the provider or its successful claim still needs the order transition. */
  awaitingConfirmation: boolean;
  /**
   * A payment may be started now: the order is payable AND either an active
   * sole attempt can be joined or no attempt exists. Multiple or terminal
   * attempts require support review until checkout revocation is established.
   * Presentation only; the initialization service enforces this rule.
   */
  canInitiate: boolean;
};

/** Result of asking the provider about a waiting attempt. */
export type PaymentVerification = {
  attempted: boolean;
  ok: boolean;
  /** `verifyPaystackPaymentStatus` outcome, when the check completed. */
  outcome?: string;
  /**
   * A `PaymentServiceErrorCode` when the provider could not be reached (or
   * the attempt's provider is retired and cannot be asked at all).
   */
  code?: string;
};

export type BuyerPaymentStatusSnapshot = BuyerPaymentSnapshot & {
  verification: PaymentVerification | null;
};

/** Payment statuses that will never change again (mirrors the state machine). */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
];

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

/** Order statuses that mean the money has been collected (mirrors order-status.ts). */
export function isPaidOrderStatus(status: OrderStatus): boolean {
  return status === "PAID" || status === "SHIPPED" || status === "DELIVERED" || status === "COMPLETED";
}

/**
 * The single question the payment UI asks of a snapshot: has this payment
 * finished, one way or another? A failure/cancellation or non-PENDING order
 * ends the polling window. A SUCCESS payment with a still-PENDING order is not
 * done: the separate order transition must be recovered or reviewed.
 */
export function isSettledSnapshot(snapshot: BuyerPaymentSnapshot): boolean {
  if (snapshot.order.status !== "PENDING") return true;
  if (snapshot.payment?.status === "SUCCESS") return false;
  return snapshot.payment !== null && isTerminalPaymentStatus(snapshot.payment.status);
}
