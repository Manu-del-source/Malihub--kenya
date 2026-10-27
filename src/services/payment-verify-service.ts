import "server-only";

import {
  createPaystackClient,
  PaystackClientError,
  paystackDomainMatches,
  resolvePaystackConfig,
  type PaystackClient,
  type PaystackConfigSource,
} from "@/lib/payments/paystack";
import {
  afterPaymentFailureRecorded,
  claimPaymentFailure,
  claimPaymentSuccess,
  markOrderPaidForPayment,
  PAYMENT_SYSTEM_ACTOR_ID,
  PaymentServiceError,
  settleSuccessfulPayment,
  type PaymentStore,
  type OrderPaidOutcome,
} from "@/services/payment-service";
import { logAuditEvent } from "@/services/audit-service";

/**
 * Paystack transaction-status verification — the recovery path for "the
 * webhook never arrived (or the buyer closed the checkout before it fired)"
 * and the cross-check channel a later reconciliation sweep will batch
 * through. Also the ONLY buyer-reachable settlement channel: the browser can
 * ask "has this payment landed?", and the server answers by asking PAYSTACK,
 * never by trusting the browser.
 *
 * ─── Two inviolable rules ──────────────────────────────────────────────────
 *  1. A locally-SUCCESS payment is returned as-is WITHOUT calling Paystack —
 *     a stale provider answer must never downgrade settled money. (The
 *     order-transition crash window is still closed first, because a
 *     successful settlement and a settled order are two steps with a crash
 *     window between them.)
 *  2. Non-SUCCESS answers go through the SAME conditional claims the webhook
 *     pipeline uses (`claimPaymentSuccess` / `claimPaymentFailure`), so
 *     verification and webhook processing cannot fork the ledger.
 *
 * ─── Success is corroborated, not assumed ─────────────────────────────────
 * The verify endpoint's `data.status === "success"` is the provider's own
 * authenticated answer, but this service re-checks the reference, the exact
 * integer amount and the currency against the Payment row, and checks the
 * configured environment, before any claim. The webhook applies the same rule.
 * A success answer for the wrong
 * amount is a contradiction, audited and refused.
 *
 * ─── Ownership ─────────────────────────────────────────────────────────────
 * This function takes a *payment* id and no buyer. The owning route
 * (`/api/payments/paystack/verify`) resolves ownership from the session
 * BEFORE calling in: the payment must belong to one of the caller's own
 * orders. A payment id from another buyer's order never reaches here, and a
 * payment row is only ever created from a known order, so the financial
 * effect (if any) lands on the caller's own order and nothing else.
 */

export type VerifyPaystackStatusResult =
  | {
      outcome: "verified_success";
      /** True when THIS call claimed the payment (false = it was already settled). */
      paymentApplied: boolean;
      orderChanged: boolean;
      anomaly?: OrderPaidOutcome["anomaly"];
    }
  | { outcome: "verified_failed"; paymentApplied: boolean }
  | { outcome: "still_pending" }
  | { outcome: "unknown_status"; rawStatus: string }
  | { outcome: "already_success" }
  /**
   * The provider says SUCCESS for THIS attempt, but a sibling attempt already
   * settled the order. No second effect is produced; the attempt is left
   * untouched for reconciliation (a possible double collection a later
   * refund phase handles).
   */
  | { outcome: "superseded" }
  /** The payment is locally FAILED/CANCELLED; a status check never resurrects it. */
  | { outcome: "already_terminal"; status: string }
  /**
   * The provider reported success but the reference/amount/currency did not
   * line up with the authoritative row. Nothing is settled; the mismatch is
   * audited for human review.
   */
  | { outcome: "verification_mismatch"; detail: "reference" | "amount" | "currency" | "environment" };

/** The Prisma slice this service reads/writes. */
export type VerifyPaymentStore = PaymentStore;

const VERIFY_PAYMENT_SELECT = {
  id: true,
  orderId: true,
  provider: true,
  status: true,
  amountCents: true,
  currency: true,
  customerReference: true,
  providerTransactionId: true,
  metadata: true,
} as const;

type PaymentRow = {
  id: string;
  orderId: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  customerReference: string;
  providerTransactionId: string | null;
  metadata: unknown;
};

/**
 * The reference(s) to verify, in priority order. `customerReference` is the
 * reference WE handed Paystack at initiation; `metadata.paystack.providerReference`
 * is the provider-echoed reference persisted at initiation (they are equal in
 * the documented happy path — the second candidate covers the edge case where
 * Paystack regenerated the reference).
 */
function verificationReferences(payment: PaymentRow): string[] {
  const refs = [payment.customerReference];
  const meta = payment.metadata as { paystack?: { providerReference?: unknown } } | null;
  const providerRef = meta?.paystack?.providerReference;
  if (typeof providerRef === "string" && providerRef && !refs.includes(providerRef)) {
    refs.push(providerRef);
  }
  return refs;
}

/**
 * Verifies a Paystack payment against `GET /transaction/verify/{reference}`.
 * See the module docstring for the trust rules.
 */
export async function verifyPaystackPaymentStatus(
  db: VerifyPaymentStore,
  params: {
    paymentId: string;
    /** Test seam: inject a stubbed provider client. */
    client?: PaystackClient;
    /** Test seam: explicit environment. Defaults to `process.env`. */
    env?: PaystackConfigSource;
  }
): Promise<VerifyPaystackStatusResult> {
  const payment = (await db.payment.findUnique({
    where: { id: params.paymentId },
    select: VERIFY_PAYMENT_SELECT,
  })) as unknown as PaymentRow | null;

  if (!payment) {
    throw new PaymentServiceError("Payment not found.", "not_found");
  }
  if (payment.provider !== "PAYSTACK") {
    // Historical rows from the retired PayHero integration (or any future
    // provider) must not be verified against Paystack: the reference would
    // not exist there, and a coincidental match on someone else's Paystack
    // transaction is an ownership violation, not a recovery.
    throw new PaymentServiceError(
      "This payment was not processed through the active provider and cannot be verified here.",
      "provider_retired"
    );
  }

  // Rule 1: settled money is settled — no provider answer gets to rewrite
  // it. But "settled payment" and "settled order" are two steps with a crash
  // window between them, so before answering, close that window: re-run the
  // idempotent order transition (a no-op when the order is already PAID, an
  // exact recovery when it isn't). No audits here: the original settlement
  // recorded its own; this path only heals the order row.
  if (payment.status === "SUCCESS") {
    await markOrderPaidForPayment(db, payment, "paystack:status-check");
    return { outcome: "already_success" };
  }
  if (payment.status !== "PENDING" && payment.status !== "PROCESSING") {
    // A terminal failure has nothing to verify into — refunds belong to a
    // later phase, and this path never resurrects a settled outcome.
    return { outcome: "already_terminal", status: payment.status };
  }

  // `process.env` carries the documented PAYSTACK_* variables at runtime; the
  // cast narrows the Node type to the seam this service documents.
  const config = resolvePaystackConfig(params.env ?? (process.env as PaystackConfigSource));
  if (!config.ok) {
    console.error("[payments] Paystack is not configured", {
      missing: config.missing,
      invalid: config.invalid,
    });
    throw new PaymentServiceError(
      "Online payments are not configured on this deployment.",
      "provider_not_configured"
    );
  }

  const client = params.client ?? createPaystackClient(config.config);

  // Try each known reference. A 404-ish rejection ("rejected") means "Paystack
  // does not know this reference" — legitimate for the secondary candidate.
  // Any other failure (network, 5xx, malformed) is a real unavailability and
  // propagates as such: "we could not ask the provider" is NOT "the payment
  // failed".
  let status: Awaited<ReturnType<PaystackClient["verifyTransaction"]>> | null = null;
  let lastError: unknown = null;
  for (const reference of verificationReferences(payment)) {
    try {
      status = await client.verifyTransaction(reference);
      break;
    } catch (error) {
      if (error instanceof PaystackClientError && error.kind === "rejected") {
        lastError = error;
        continue;
      }
      if (error instanceof PaystackClientError) {
        throw new PaymentServiceError(error.message, mapKindToCode(error.kind));
      }
      throw error;
    }
  }
  if (!status) {
    // None of the known references exists at Paystack: the initiation never
    // completed provider-side (or the provider side was purged). Nothing to
    // verify — report honestly as unavailable rather than inventing a state.
    throw new PaymentServiceError(
      lastError instanceof Error ? lastError.message : "Paystack does not recognise this transaction.",
      "provider_rejected"
    );
  }

  // Only a definitive failed response may release an attempt. In particular,
  // ongoing/processing/queued, abandoned and unknown provider states must not
  // be guessed terminal: their checkout might still be payable externally.
  if (status.status !== "success" && status.status !== "failed") {
    if (["pending", "default", "ongoing", "processing", "queued", "abandoned"].includes(status.status)) {
      return { outcome: "still_pending" };
    }
    return { outcome: "unknown_status", rawStatus: status.status };
  }

  // A success OR definitive failure must match the configured environment,
  // reference, amount and currency before it can change local state.
  if (!paystackDomainMatches(config.config, status.domain)) {
    await logMismatchAudit(db, payment, "environment", { reportedDomain: typeof status.domain === "string" ? status.domain : null });
    return { outcome: "verification_mismatch", detail: "environment" };
  }
  if (status.reference !== payment.customerReference &&
      status.reference !== (payment.metadata as { paystack?: { providerReference?: unknown } } | null)?.paystack?.providerReference) {
    await logMismatchAudit(db, payment, "reference", {
      reportedReference: status.reference,
      expectedReference: payment.customerReference,
    });
    return { outcome: "verification_mismatch", detail: "reference" };
  }
  if (!Number.isSafeInteger(status.amount) || status.amount !== payment.amountCents) {
    await logMismatchAudit(db, payment, "amount", {
      reportedAmount: status.amount,
      expectedAmountCents: payment.amountCents,
    });
    return { outcome: "verification_mismatch", detail: "amount" };
  }
  if (status.currency !== payment.currency) {
    await logMismatchAudit(db, payment, "currency", {
      reportedCurrency: status.currency,
      expectedCurrency: payment.currency,
    });
    return { outcome: "verification_mismatch", detail: "currency" };
  }

  if (status.status === "failed") {
    const initialization = (payment.metadata as { paystack?: { initialization?: unknown } } | null)?.paystack?.initialization;
    // Initialization may still be returning an access code to another
    // request. Do not release that reservation based on an intermediate
    // failure observed before the provider response has been persisted.
    if (initialization === "pending") return { outcome: "still_pending" };
    const claim = await db.$transaction(async (tx) =>
      claimPaymentFailure(tx, payment, { to: "FAILED", code: null, reason: "Paystack reported status \"failed\"." }, undefined)
    );
    if (claim === "claimed") await afterTerminalFailure(db, payment, "paystack:status-check", "FAILED");
    return { outcome: "verified_failed", paymentApplied: claim === "claimed" };
  }

  const claim = await db.$transaction(async (tx) =>
    claimPaymentSuccess(
      tx,
      payment,
      {
        providerReference: status.reference,
        providerTransactionId: status.id != null ? String(status.id) : undefined,
      },
      undefined
    )
  );

  if (claim === "superseded") {
    // The provider confirms THIS attempt collected too, but a sibling attempt
    // already settled the order — the textbook double collection. No second
    // effect: the attempt is left untouched and flagged for reconciliation.
    console.warn("[payments] Paystack reported SUCCESS for a superseded payment attempt", {
      paymentId: payment.id,
    });
    await logAuditEvent({
      action: "payment.anomaly",
      actorId: PAYMENT_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYSTACK",
        orderId: payment.orderId,
        customerReference: payment.customerReference,
        amountCents: payment.amountCents,
        anomaly: "superseded_success",
        source: "paystack:status-check",
      },
    }).catch(() => undefined);
    return { outcome: "superseded" };
  }

  if (claim === "already_terminal_other") {
    // Local terminal failure + provider success = a contradiction a human
    // must see; the first-recorded terminal outcome stays authoritative.
    console.error("[payments] Paystack status SUCCESS contradicts local terminal state", {
      paymentId: payment.id,
    });
    return { outcome: "verified_failed", paymentApplied: false };
  }

  const orderOutcome = await settleSuccessfulPayment(db, payment, {
    source: "paystack:status-check",
    claimedNow: claim === "claimed",
    provider: "PAYSTACK",
  });
  return {
    outcome: "verified_success",
    paymentApplied: claim === "claimed",
    orderChanged: orderOutcome.orderChanged,
    anomaly: orderOutcome.anomaly,
  };
}

function mapKindToCode(kind: PaystackClientError["kind"]): PaymentServiceError["code"] {
  switch (kind) {
    case "not_configured":
      return "provider_not_configured";
    case "rejected":
      return "provider_rejected";
    case "invalid_response":
      return "provider_invalid_response";
    case "unavailable":
    default:
      return "provider_unavailable";
  }
}

/** Audit-only mismatch record — deliberately NO state change. */
async function logMismatchAudit(
  db: VerifyPaymentStore,
  payment: PaymentRow,
  detail: "reference" | "amount" | "currency" | "environment",
  extra: Record<string, unknown>
): Promise<void> {
  console.error("[payments] Paystack verification mismatch", {
    paymentId: payment.id,
    detail,
  });
  await logAuditEvent({
    action: "payment.verification_mismatch",
    actorId: PAYMENT_SYSTEM_ACTOR_ID,
    targetType: "payment",
    targetId: payment.id,
    metadata: {
      provider: "PAYSTACK",
      orderId: payment.orderId,
      customerReference: payment.customerReference,
      detail,
      source: "paystack:status-check",
      ...extra,
    },
  }).catch(() => undefined);
}

/** Same fan-out the webhook pipeline uses for recorded terminal failures. */
async function afterTerminalFailure(
  db: VerifyPaymentStore,
  payment: { id: string; orderId: string; amountCents: number },
  source: string,
  to: "FAILED" | "CANCELLED"
): Promise<void> {
  // Reuse the shared post-commit fan-out (audit + buyer notification).
  await afterPaymentFailureRecorded(db, payment, source, to, "PAYSTACK");
}
