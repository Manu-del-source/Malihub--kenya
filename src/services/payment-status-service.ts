import "server-only";

import type { PaymentStatus, Prisma, PrismaClient, OrderStatus } from "@prisma/client";
import {
  MAX_PAYMENT_ATTEMPTS_PER_ORDER,
  PaymentServiceError,
  type PaymentStore,
} from "@/services/payment-service";
import {
  verifyPaystackPaymentStatus,
  type VerifyPaystackStatusResult,
} from "@/services/payment-verify-service";
import type { PaystackClient, PaystackConfigSource } from "@/lib/payments/paystack";
import type {
  BuyerPaymentSnapshot,
  BuyerPaymentStatusSnapshot,
  PaymentVerification,
} from "@/lib/payments/payment-snapshot";

/**
 * Buyer-facing order → payment status.
 *
 * ─── Why this is a separate, small service ──────────────────────────────────
 * `payment-service.ts` owns settlement; it takes a *payment* id and no buyer.
 * The checkout and order screens need the opposite entry point: "what is the
 * state of MY order's payment", asked by a session, answered with a snapshot
 * safe to render. This service is that thin, ownership-enforcing adapter — it
 * adds no new financial logic and never writes money state itself.
 * Verification, when requested, is delegated to the provider-verify service
 * (Paystack), so the buyer path and the webhook path cannot disagree about
 * what "paid" means.
 *
 * ─── Provider scope ─────────────────────────────────────────────────────────
 * `Payment.provider` contains live PAYSTACK rows and historical PAYHERO rows
 * (the pre-migration integration; no code in this repository can create a new
 * one). The snapshot shows the buyer's LATEST attempt across providers so a
 * legacy in-flight row can't vanish from their screen. Verification dispatches
 * by provider: PAYSTACK attempts are verified against Paystack's API; a
 * PAYHERO attempt is reported as `provider_retired` — honestly unverifiable —
 * rather than being faked through the wrong provider or silently dropped.
 *
 * ─── Ownership ─────────────────────────────────────────────────────────────
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
  provider: true,
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
  provider: string;
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
 * Reads the session-owner's order and its latest payment attempt (any
 * provider — live Paystack rows first by creation order, historical rows
 * after).
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
    where: { orderId: order.id },
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
          provider: latest.provider,
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
    // a NEW attempt requires budget left. The route re-checks both — this is
    // presentation, not enforcement.
    canInitiate: payable && (awaitingConfirmation || remaining > 0),
  };
}

/**
 * The same snapshot, but first asking Paystack about a waiting attempt when
 * there is one to ask about — the recovery path for "the webhook never
 * arrived", and the mechanism the checkout screen polls while it waits.
 *
 * Failure to reach the provider is NOT a failure of the status read: the
 * snapshot is returned with `verification.ok === false` and the reason code,
 * so the UI can honestly say "we could not confirm the payment yet; your
 * payment is still being checked". A genuine internal crash still throws.
 *
 * A waiting attempt from a retired provider (PAYHERO) cannot be asked: the
 * verification result is `ok: false, code: "provider_retired"` and the attempt
 * is left exactly as it is.
 */
export async function verifyBuyerPaymentStatus(
  db: PaymentStore,
  params: {
    userId: string;
    orderId: string;
    /** Test seam: inject a stubbed provider client. */
    client?: PaystackClient;
    /** Test seam: explicit environment. Defaults to `process.env`. */
    env?: PaystackConfigSource;
  }
): Promise<BuyerPaymentStatusSnapshot | null> {
  const initial = await readBuyerPaymentSnapshot(db, params);
  if (!initial) return null;

  // Nothing waiting on the provider → nothing to verify, and no round-trip.
  const latest = initial.payment;
  const verificationTarget =
    initial.awaitingConfirmation && latest
      ? latest
      : null;

  if (!verificationTarget) {
    return { ...initial, verification: null };
  }

  if (verificationTarget.provider !== "PAYSTACK") {
    // Historical row from the retired PayHero integration. There is no PayHero
    // client left in this codebase to ask, and pretending to verify it
    // through Paystack would be an ownership/identity error. Report it.
    const verification: PaymentVerification = {
      attempted: true,
      ok: false,
      code: "provider_retired",
    };
    return { ...initial, verification };
  }

  let verification: PaymentVerification;
  try {
    const result: VerifyPaystackStatusResult = await verifyPaystackPaymentStatus(db, {
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
