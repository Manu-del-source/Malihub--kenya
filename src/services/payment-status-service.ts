import "server-only";

import type { PaymentStatus, Prisma, PrismaClient, OrderStatus } from "@prisma/client";
import {
  MAX_PAYMENT_ATTEMPTS_PER_ORDER,
  PaymentServiceError,
  verifyPayheroPaymentStatus,
  type PaymentStore,
  type PayheroConfigSource,
} from "@/services/payment-service";
import type { PayheroClient } from "@/lib/payments/payhero";
import type {
  BuyerPaymentSnapshot,
  BuyerPaymentStatusSnapshot,
  PaymentVerification,
} from "@/lib/payments/payment-snapshot";

/**
 * Buyer-facing order → payment status.
 *
 * ─── Why this is a separate, small service ──────────────────────────────────
 * `payment-service.ts` owns collection and settlement; it exposes
 * `verifyPayheroPaymentStatus(paymentId)` but takes a *payment* id and no
 * buyer. The checkout and order screens need the opposite entry point: "what
 * is the state of MY order's payment", asked by a session, answered with a
 * snapshot safe to render. This service is that thin, ownership-enforcing
 * adapter — it adds no new financial logic and never writes money state
 * itself. Verification, when requested, is delegated to the existing
 * transaction-status service, so the callback and this path cannot disagree
 * about what "paid" means.
 *
 * ─── Ownership ──────────────────────────────────────────────────────────────
 * Every read is scoped `{ id: orderId, buyerId: userId }` where `userId` is
 * resolved from the session by the route. An order that does not exist and one
 * that belongs to someone else are the same answer (`null` → 404), so order
 * ids cannot be probed for existence.
 *
 * ─── What is never returned ─────────────────────────────────────────────────
 * No payer phone number (`Payment.payerReference`), no `metadata` blob, no raw
 * callback payload, no provider credentials — see `payment-snapshot.ts`.
 */

/** The Prisma slice a read needs (verify needs the fuller `PaymentStore`). */
export type PaymentStatusStore = Pick<PrismaClient, "order" | "payment">;

const ATTEMPT_SELECT = {
  id: true,
  status: true,
  amountCents: true,
  customerReference: true,
  providerTransactionId: true,
  providerReference: true,
  retryCount: true,
  createdAt: true,
  paidAt: true,
  failureCode: true,
  failureReason: true,
} satisfies Prisma.PaymentSelect;

type AttemptRow = {
  id: string;
  status: string;
  amountCents: number;
  customerReference: string;
  providerTransactionId: string | null;
  providerReference: string | null;
  retryCount: number;
  createdAt: Date;
  paidAt: Date | null;
  failureCode: string | null;
  failureReason: string | null;
};

/**
 * Reads the session-owner's order and its latest PayHero attempt.
 *
 * `null` means "no such order, or it is not yours" — the route answers 404,
 * identically for both, exactly like `getBuyerOrder` and the initiation route.
 */
export async function readBuyerPaymentSnapshot(
  db: PaymentStatusStore,
  params: { userId: string; orderId: string }
): Promise<BuyerPaymentSnapshot | null> {
  const order = (await db.order.findFirst({
    where: { id: params.orderId, buyerId: params.userId },
    select: { id: true, orderNumber: true, status: true, totalCents: true },
  })) as { id: string; orderNumber: string; status: string; totalCents: number } | null;

  if (!order) return null;

  const attempts = (await db.payment.findMany({
    where: { orderId: order.id, provider: "PAYHERO" },
    orderBy: { createdAt: "desc" },
    select: ATTEMPT_SELECT,
  })) as unknown as AttemptRow[];

  const latest = attempts[0] ?? null;
  const payable = order.status === "PENDING";
  const awaitingConfirmation = Boolean(
    latest && (latest.status === "PENDING" || latest.status === "PROCESSING")
  );
  const remaining = Math.max(0, MAX_PAYMENT_ATTEMPTS_PER_ORDER - attempts.length);

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status as OrderStatus,
      totalCents: order.totalCents,
    },
    payment: latest
      ? {
          id: latest.id,
          status: latest.status as PaymentStatus,
          amountCents: latest.amountCents,
          customerReference: latest.customerReference,
          providerTransactionId: latest.providerTransactionId,
          providerReference: latest.providerReference,
          retryCount: latest.retryCount,
          createdAt: latest.createdAt.toISOString(),
          paidAt: latest.paidAt ? latest.paidAt.toISOString() : null,
          failureCode: latest.failureCode,
          failureReason: latest.failureReason,
        }
      : null,
    attempts: {
      used: attempts.length,
      max: MAX_PAYMENT_ATTEMPTS_PER_ORDER,
      remaining,
    },
    payable,
    awaitingConfirmation,
    // An active attempt may always be joined/resumed (never capped); creating
    // a NEW attempt requires budget left. The service re-checks both — this
    // is presentation, not enforcement.
    canInitiate: payable && (awaitingConfirmation || remaining > 0),
  };
}

/**
 * The same snapshot, but first asking PayHero about a waiting attempt when
 * there is one to ask about — the recovery path for "the callback never
 * arrived", and the mechanism the checkout screen polls while it waits.
 *
 * Failure to reach the provider is NOT a failure of the status read: the
 * snapshot is returned with `verification.ok === false` and the reason code, so
 * the UI can honestly say "we could not reach M-Pesa; your payment is still
 * being confirmed". A genuine internal crash still throws.
 */
export async function verifyBuyerPaymentStatus(
  db: PaymentStore,
  params: {
    userId: string;
    orderId: string;
    /** Test seam: inject a stubbed provider client. */
    client?: PayheroClient;
    /** Test seam: explicit environment. Defaults to `process.env`. */
    env?: PayheroConfigSource;
  }
): Promise<BuyerPaymentStatusSnapshot | null> {
  const initial = await readBuyerPaymentSnapshot(db, params);
  if (!initial) return null;

  // Nothing waiting on the provider → nothing to verify, and no round-trip.
  // An attempt with no provider transaction id is still "reserved" (the STK
  // call never completed); the next initiation resumes it, so there is no
  // provider reference to look up yet.
  const verificationTarget =
    initial.awaitingConfirmation && initial.payment?.providerTransactionId
      ? initial.payment
      : null;

  if (!verificationTarget) {
    return { ...initial, verification: null };
  }

  let verification: PaymentVerification;
  try {
    const result = await verifyPayheroPaymentStatus(db, {
      paymentId: verificationTarget.id,
      ...(params.client ? { client: params.client } : {}),
      ...(params.env ? { env: params.env } : {}),
    });
    verification = { attempted: true, ok: true, outcome: result.outcome };
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      // Provider/config problems are reported alongside the still-authoritative
      // local state; the caller keeps showing "waiting", not a fake outcome.
      verification = { attempted: true, ok: false, code: error.code };
    } else {
      throw error;
    }
  }

  // Re-read so the response reflects whatever verification just settled (a
  // successful check can move the payment to SUCCESS and the order to PAID).
  const after = await readBuyerPaymentSnapshot(db, params);
  return { ...(after ?? initial), verification };
}
