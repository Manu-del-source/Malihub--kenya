import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertPaymentTransition,
  CLAIMABLE_PAYMENT_STATUSES,
} from "@/lib/payment-state-machine";
import { logAuditEvent } from "@/services/audit-service";
import { notifyUser } from "@/services/notification-service";
import { ensureSupplierFulfilmentsForPaidOrder } from "@/services/dropshipping-fulfilment-service";
import { markOrderPaid, OrderTransitionError } from "@/services/order-transition-service";

/**
 * Payment settlement — provider-neutral core (Phase 10).
 *
 * ─── What this service owns ────────────────────────────────────────────────
 *  1. Settlement primitives — the conditional Payment claims every trusted
 *     success channel shares (Paystack webhook, Paystack status verification).
 *  2. The two-step order transition (`markOrderPaidForPayment`) and its
 *     canonical completion (`settleSuccessfulPayment`).
 *
 * Collection (initiating a Paystack transaction) lives in the
 * `POST /api/payments/paystack/initialize` route; the inbound webhook
 * pipeline lives in `payment-webhook-service.ts`; buyer-facing verification
 * lives in `payment-verify-service.ts`. All three funnel into the SAME claim
 * + order-transition primitives here, so no two channels can disagree about
 * what "paid" means.
 *
 * ─── Trust boundaries (the whole point of the flow) ────────────────────────
 *  - The amount comes from `Payment.amountCents`, copied at creation from
 *    `Order.totalCents` read inside the transaction — never from a request.
 *  - `provider`, `method` and every provider setting come from server code —
 *    never from a client.
 *  - `Payment.customerReference` is OUR value (a unique `MH-…` reference we
 *    hand the provider), persisted BEFORE the provider is called. It is what
 *    correlates a webhook/verification answer to a payment without trusting
 *    any client-provided id.
 *  - A "processing" or "queued" provider answer is NOT a collected payment
 *    and nothing here treats it as one. Only a provider-verified success
 *    (signed webhook + `GET /transaction/verify` confirmation, or an
 *    authenticated status check) can move an attempt to SUCCESS.
 *
 * ─── Identifier mapping (existing schema fields, no new columns) ────────────
 *  - `Payment.customerReference`      ← our reference, echoed back by the
 *    provider in webhooks and verification responses.
 *  - `Payment.providerTransactionId`  ← the processor's own transaction id
 *    (unique; for Paystack this is the 64-bit transaction `id`).
 *  - `Payment.providerReference`      ← the settlement reference a customer
 *    can quote (for Paystack, the transaction `reference`).
 *  - `Payment.metadata.paystack`      ← provider-specific opaque detail.
 *  - `Payment.rawCallbackPayload`     ← the verbatim inbound callback body.
 *    The redacted copy goes to `PaymentEvent.rawPayload`.
 *
 * ─── Historical provider rows ──────────────────────────────────────────────
 * `Payment.provider` still contains `PAYHERO` rows from the pre-migration
 * integration. Those rows are HISTORY: this service never mutates them (their
 * status is terminal for all live rows), and no code path in this repository
 * can create a new one. Reconciliation reads them read-only.
 *
 * ─── One effective successful payment per order ────────────────────────────
 * Two attempts can both be provider-visible (a checkout the buyer completes
 * after we recorded an earlier attempt, a transaction we timed out on that
 * succeeded anyway), and each can attract a success webhook. Only ONE may
 * ever settle the order: the success claim runs under the SAME order-keyed
 * advisory lock (`pg_advisory_xact_lock(hashtext(orderId))`), so concurrent
 * success claims for sibling attempts serialize, and the loser observes the
 * winner's committed SUCCESS sibling and is refused (`"superseded"`). The
 * order's own `PENDING → PAID` transition is a conditional claim regardless —
 * two layers, no schema changes.
 *
 * ─── Two-step settle, on purpose ───────────────────────────────────────────
 * The Payment claim commits FIRST; the `PENDING → PAID` order transition runs
 * SECOND via `settleSuccessfulPayment` → `markOrderPaid` (its own guarded
 * transaction). They are deliberately not one transaction: `markOrderPaid`
 * performs its audit and notification fan-out after IT commits, and wrapping
 * it inside an outer transaction would fire those side effects while the
 * outer write could still roll back.
 *
 * The crash window between the steps (payment SUCCESS, order not yet PAID)
 * is closed by RECOVERY, not by hope: every path that observes a SUCCESS
 * payment re-runs the idempotent order transition —
 *  - the settlement finalizer itself (normal path),
 *  - a duplicate webhook-event replay (`handlePaystackWebhook` recovers
 *    silently on P2002 when the payment is SUCCESS),
 *  - status verification on an already-SUCCESS payment (re-runs step two
 *    before answering `already_success`).
 * `markOrderPaid` is a no-op when the order is already PAID, so recovery is
 * effect-free in the common case and exactly right in the crash case.
 */

export type PaymentStore = Pick<
  PrismaClient,
  | "order"
  | "orderItem"
  | "product"
  | "seller"
  | "payment"
  | "paymentEvent"
  | "$transaction"
  | "$executeRaw"
>;

/** The transaction-scoped slice used inside claims. */
export type PaymentTxStore = Pick<
  Prisma.TransactionClient,
  "order" | "payment" | "paymentEvent" | "$executeRaw"
>;

/**
 * The minimal payment-row shape the settlement primitives need. Both the
 * webhook pipeline's select shape and the verify path's satisfy it, so
 * neither side has to over-fetch (or cast) to settle.
 */
export type SettleablePaymentRow = {
  id: string;
  orderId: string;
  status: string;
  amountCents: number;
  currency: string;
  customerReference: string;
  providerTransactionId: string | null;
  metadata: unknown;
};

// ─── Errors ──────────────────────────────────────────────────────────────────

export type PaymentServiceErrorCode =
  /** No such order, or the order belongs to someone else (same answer on purpose). */
  | "not_found"
  /** The order is in a state money cannot be collected against (e.g. CANCELLED). */
  | "not_payable"
  /** The order is already PAID — there is nothing left to collect. */
  | "already_paid"
  /** The order total cannot be represented for this provider. */
  | "invalid_amount"
  /** Required PAYSTACK_* environment variables are missing or invalid. */
  | "provider_not_configured"
  /** The provider actively refused the request (4xx / success:false). */
  | "provider_rejected"
  /** Provider 5xx, network failure, or timeout. */
  | "provider_unavailable"
  /** A 2xx answer that did not match the documented shape. */
  | "provider_invalid_response"
  /**
   * The order has used up its payment attempts. Bounded retries are a
   * deliberate abuse control: a healthy buyer succeeds within a few attempts,
   * and beyond the cap collection stops until a human looks.
   */
  | "attempt_limit"
  /**
   * The attempt belongs to a provider that is no longer integrated in this
   * deployment (e.g. a PAYHERO row left over from the pre-Paystack phase).
   * Verification cannot ask a retired provider, and nothing here pretends it
   * can.
   */
  | "provider_retired";

export class PaymentServiceError extends Error {
  readonly code: PaymentServiceErrorCode;

  constructor(message: string, code: PaymentServiceErrorCode) {
    super(message);
    this.name = "PaymentServiceError";
    this.code = code;
  }
}

/**
 * A deterministic, globally-unique actor id for system-driven financial
 * events. `audit_logs.actor_id` is a UUID column, so a scheme like
 * `"paystack-webhook"` cannot be written to it; the nil UUID is a valid UUID
 * that can never collide with a real user, and `metadata.source` carries the
 * human-readable origin (already the convention in `markOrderPaid`).
 */
export const PAYMENT_SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Hard cap on collection attempts per order (abuse control). Counting every
 * attempt row for the order — including CANCELLED ones, because a scripted
 * "abandon, retry, abandon" loop must also run out of road. Five is generous
 * for a real buyer who lost signal twice and cancelled once; past it, the
 * order stays payable in every other respect but automated collection stops
 * until a human intervenes. Joining/resuming an ACTIVE attempt never counts —
 * only the creation of a NEW attempt is capped.
 */
export const MAX_PAYMENT_ATTEMPTS_PER_ORDER = 5;

// ─── 1. Settlement primitives (webhook + status verification share these) ──

export type SuccessClaim =
  | "claimed"
  /** The payment was already SUCCESS — a replay, not a new effect. */
  | "already_success"
  /** The payment is FAILED/CANCELLED/REFUNDED — a contradictory late success. */
  | "already_terminal_other"
  /**
   * A SIBLING payment for the same order is already SUCCESS. One effective
   * successful payment per order, enforced under the order-keyed advisory
   * lock: this attempt is the loser of the Payment A vs Payment B race and
   * must produce no further financial effect.
   */
  | "superseded";

export type PaymentIdentifiers = {
  /** The settlement reference a customer can quote (Paystack `reference`). */
  providerReference?: string | null;
  /** The processor's own transaction id (Paystack transaction `id`). */
  providerTransactionId?: string | null;
};

/**
 * Claims a payment as SUCCESS inside an OPEN transaction, guarded by a
 * conditional update on its current status. The caller owns the transaction
 * (the webhook pipeline also records its PaymentEvent in the same one).
 *
 * ─── Serialization ─────────────────────────────────────────────────────────
 * The claim runs under `pg_advisory_xact_lock(hashtext(orderId))` — the same
 * order-scoped key used across the payment surface — so ALL success
 * settlements for an order (webhook, status verification, concurrency,
 * retries) pass through a single gate. Inside the gate the function re-reads
 * the row (the caller fetched it pre-transaction, potentially before a
 * competing claim committed) and checks for a SIBLING success: if another
 * payment of this order is already SUCCESS, this attempt is superseded and
 * produces no further effect; one effective successful payment per order, at
 * the database level, never by trusting a previously-read status.
 *
 * Money metadata is only written when the claim succeeds — a replay or a
 * contradictory late success can never overwrite the winning settlement's
 * reference or payload.
 */
export async function claimPaymentSuccess(
  tx: PaymentTxStore,
  payment: SettleablePaymentRow,
  identifiers: PaymentIdentifiers,
  rawPayload: unknown
): Promise<SuccessClaim> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payment.orderId}))`;

  const current = (await tx.payment.findUnique({
    where: { id: payment.id },
    select: { status: true },
  })) as { status: string } | null;

  if (current?.status === "SUCCESS") return "already_success";
  if (!current || !CLAIMABLE_PAYMENT_STATUSES.includes(current.status as never)) {
    return "already_terminal_other";
  }

  // The loser of a Payment A vs Payment B callback race lands here: a
  // sibling already carries the order's one effective success.
  const settledSibling = (await tx.payment.findFirst({
    where: { orderId: payment.orderId, status: "SUCCESS" },
    select: { id: true },
  })) as { id: string } | null;
  if (settledSibling && settledSibling.id !== payment.id) return "superseded";

  // Pure legality check ahead of the write; the conditional update below
  // remains the enforcement boundary, because only it is atomic.
  assertPaymentTransition(current.status as never, "SUCCESS");

  let data: Prisma.PaymentUpdateManyMutationInput = {
    status: "SUCCESS",
    paidAt: new Date(),
    metadata: mergeProviderMetadata(payment.metadata, "paystack", {}),
  };
  if (identifiers.providerReference) {
    data = { ...data, providerReference: identifiers.providerReference };
  }
  if (!payment.providerTransactionId && identifiers.providerTransactionId) {
    data = { ...data, providerTransactionId: identifiers.providerTransactionId };
  }
  if (rawPayload !== undefined) {
    data = { ...data, rawCallbackPayload: rawPayload as Prisma.InputJsonValue };
  }

  const claimed = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["PENDING", "PROCESSING"] } },
    data,
  });
  if (claimed.count === 1) return "claimed";

  // Lost a same-row race — read back and classify. (Under the order-scoped
  // advisory lock this is belt-and-braces: the lock already serialized any
  // same-order competitor; the read-back keeps the classification correct
  // regardless.)
  const afterClaim = (await tx.payment.findUnique({
    where: { id: payment.id },
    select: { status: true },
  })) as { status: string } | null;
  if (afterClaim?.status === "SUCCESS") return "already_success";
  return "already_terminal_other";
}

/** Marks a payment terminally FAILED or CANCELLED, under the same claim rule. */
export async function claimPaymentFailure(
  tx: PaymentTxStore,
  payment: SettleablePaymentRow,
  failure: { to: "FAILED" | "CANCELLED"; code: string | null; reason: string | null },
  rawPayload: unknown
): Promise<"claimed" | "already_terminal"> {
  // Serialize failure against initialization, cancellation and success claims
  // on the same order, then let the conditional write handle stale reads.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payment.orderId}))`;
  if (!CLAIMABLE_PAYMENT_STATUSES.includes(payment.status as never)) {
    return "already_terminal";
  }
  assertPaymentTransition(payment.status as never, failure.to);

  const claimed = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["PENDING", "PROCESSING"] } },
    data: {
      status: failure.to,
      failureCode: failure.code,
      failureReason: failure.reason,
      ...(rawPayload !== undefined
        ? { rawCallbackPayload: rawPayload as Prisma.InputJsonValue }
        : {}),
    },
  });
  return claimed.count === 1 ? "claimed" : "already_terminal";
}

export type OrderPaidOutcome = {
  /** True when this call moved the order PENDING → PAID. */
  orderChanged: boolean;
  orderStatus: string;
  /**
   * Set when the order could NOT be marked paid even though the payment is a
   * genuine success — e.g. a cancellation won the race first. The payment row
   * stays SUCCESS (the money really arrived); the anomaly is the signal a
   * later reconciliation/refund phase acts on.
   */
  anomaly?: "order_cancelled" | "order_not_found" | "amount_mismatch" | "invalid_transition";
};

/**
 * Step two of settlement: the order transition, via the existing state-machine
 * primitive. Safe to call repeatedly (retried webhooks, status checks) — an
 * already-PAID order is a no-op, and a cancelled order surfaces as an anomaly
 * rather than being resurrected.
 */
export async function markOrderPaidForPayment(
  db: PaymentStore,
  payment: { orderId: string; amountCents: number },
  source: string
): Promise<OrderPaidOutcome> {
  try {
    const result = await markOrderPaid(db, {
      orderId: payment.orderId,
      confirmedTotalCents: payment.amountCents,
      actor: { id: PAYMENT_SYSTEM_ACTOR_ID, source },
    });
    return { orderChanged: result.changed, orderStatus: result.order.status };
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      if (error.code === "not_found") {
        return { orderChanged: false, orderStatus: "UNKNOWN", anomaly: "order_not_found" };
      }
      if (error.code === "amount_mismatch") {
        return {
          orderChanged: false,
          orderStatus: error.currentStatus ?? "UNKNOWN",
          anomaly: "amount_mismatch",
        };
      }
      if (error.currentStatus === "CANCELLED") {
        return {
          orderChanged: false,
          orderStatus: "CANCELLED",
          anomaly: "order_cancelled",
        };
      }
      return {
        orderChanged: false,
        orderStatus: error.currentStatus ?? "UNKNOWN",
        anomaly: "invalid_transition",
      };
    }
    throw error;
  }
}

export type SettleSuccessOutcome = OrderPaidOutcome & {
  /** True when THIS settle emitted the (single) `payment.success` audit. */
  successAudited: boolean;
};

/**
 * The payment store is a narrow Pick used by the existing webhook/verify
 * tests. Only call the dropshipping fan-out when the new delegates are present;
 * otherwise a replay on a non-dropshipping store must behave exactly as before.
 */
function hasSupplierFulfilmentDelegates(
  db: PaymentStore,
): db is PaymentStore & Parameters<typeof ensureSupplierFulfilmentsForPaidOrder>[0] {
  const candidate = db as unknown as Record<string, unknown>;
  const fulfilment = candidate.supplierFulfilment as Record<string, unknown> | undefined;
  return typeof fulfilment?.create === "function" && typeof fulfilment?.findUnique === "function";
}

/**
 * The canonical post-claim completion of a successful payment — the ONLY code
 * that turns a claimed SUCCESS into an order transition plus its audit trail.
 *
 * Every trusted channel (signed webhook, transaction-status verification)
 * that just observed a legitimately-claimed success calls this after its claim
 * transaction commits. It exists so the two channels cannot drift: the order
 * transition, the once-only `payment.success` audit, and the anomaly audit
 * (e.g. cancellation won the race) all live in exactly one place.
 *
 * Idempotent by composition: `markOrderPaidForPayment` is a no-op on an
 * already-PAID order, and `claimedNow` gates `payment.success` to the single
 * invocation that flipped the row, so recoveries and replays never double-
 * audit or double-notify.
 */
export async function settleSuccessfulPayment(
  db: PaymentStore,
  payment: {
    id: string;
    orderId: string;
    amountCents: number;
    customerReference: string;
  },
  options: { source: string; claimedNow: boolean; provider?: string }
): Promise<SettleSuccessOutcome> {
  const orderOutcome = await markOrderPaidForPayment(db, payment, options.source);

  const breadcrumbs: Promise<unknown>[] = [];
  let successAudited = false;

  if (options.claimedNow) {
    successAudited = true;
    breadcrumbs.push(
      logAuditEvent({
        action: "payment.success",
        actorId: PAYMENT_SYSTEM_ACTOR_ID,
        targetType: "payment",
        targetId: payment.id,
        metadata: {
          provider: options.provider ?? "PAYSTACK",
          orderId: payment.orderId,
          amountCents: payment.amountCents,
          customerReference: payment.customerReference,
          source: options.source,
        },
      }).catch(() => undefined)
    );
  }

  if (orderOutcome.anomaly) {
    breadcrumbs.push(
      logAuditEvent({
        action: "payment.anomaly",
        actorId: PAYMENT_SYSTEM_ACTOR_ID,
        targetType: "payment",
        targetId: payment.id,
        metadata: {
          provider: options.provider ?? "PAYSTACK",
          orderId: payment.orderId,
          customerReference: payment.customerReference,
          amountCents: payment.amountCents,
          anomaly: orderOutcome.anomaly,
          orderStatus: orderOutcome.orderStatus,
          source: options.source,
        },
      }).catch(() => undefined)
    );
  }

  // Best-effort, post-commit dropshipping fan-out. A verified payment remains
  // settled even if task creation fails; the failure is audited for the admin
  // exception queue and a duplicate verified-payment event can safely retry
  // because each task is keyed by its order item.
  if (
    orderOutcome.orderStatus === "PAID" &&
    !orderOutcome.anomaly &&
    hasSupplierFulfilmentDelegates(db)
  ) {
    breadcrumbs.push(
      ensureSupplierFulfilmentsForPaidOrder(db, payment.orderId).catch((error) => {
        console.error("Supplier fulfilment post-payment creation failed", {
          code: typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "unexpected",
        });
        return logAuditEvent({
          action: "supplier_fulfilment.creation_failed",
          actorId: PAYMENT_SYSTEM_ACTOR_ID,
          targetType: "order",
          targetId: payment.orderId,
          metadata: { source: options.source, reason: "post_payment_fanout_failed" },
        }).catch(() => undefined);
      }),
    );
  }

  await Promise.all(breadcrumbs);
  return { ...orderOutcome, successAudited };
}

/**
 * Best-effort post-commit fan-out for a recorded terminal non-collection:
 * audit + a buyer notification. Both are deliberately outside the
 * transaction, exactly like the transition service — the ledger write is
 * authoritative and must not be rollable-back by an email hiccup.
 *
 * `payment.cancelled` vs `payment.failed` is kept distinct on purpose: a
 * buyer who abandoned the checkout and one whose payment actually failed are
 * different support situations, and neither touches the ORDER. A new checkout
 * is held for support review until the old hosted checkout can be reconciled.
 */
export async function afterPaymentFailureRecorded(
  db: PaymentStore,
  payment: { id: string; orderId: string; amountCents: number },
  source: string,
  to: "FAILED" | "CANCELLED",
  provider: string = "PAYSTACK"
): Promise<void> {
  const order = (await db.order.findUnique({
    where: { id: payment.orderId },
    select: { orderNumber: true, buyerId: true },
  })) as { orderNumber: string; buyerId: string } | null;

  await Promise.all([
    logAuditEvent({
      action: to === "CANCELLED" ? "payment.cancelled" : "payment.failed",
      actorId: PAYMENT_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider,
        orderId: payment.orderId,
        orderNumber: order?.orderNumber ?? null,
        amountCents: payment.amountCents,
        attemptOutcome: to,
        source,
      },
    }).catch(() => undefined),
    order
      ? notifyUser({
          userId: order.buyerId,
          type: "PAYMENT_UPDATE",
          title: `Payment for order ${order.orderNumber} was not completed`,
          body:
            to === "CANCELLED"
              ? "The payment was reported cancelled. Contact support to reconcile the checkout before starting another payment."
              : "The payment was reported unsuccessful. Contact support to reconcile the checkout before starting another payment.",
          linkUrl: `/buyer/orders`,
        }).catch(() => undefined)
      : Promise.resolve(),
  ]);
}

// ─── Provider metadata helpers ───────────────────────────────────────────────

/**
 * Merges a patch into a provider-specific namespace inside `Payment.metadata`.
 * Provider namespaces (`paystack`, historically `payhero`) are merged shallowly
 * so an earlier initialization detail (e.g. the access code) survives a later
 * verification write. Returns a NEW object; the input is never mutated.
 */
export function mergeProviderMetadata(
  existing: unknown,
  providerNamespace: string,
  patch: Record<string, unknown>
): Prisma.InputJsonObject {
  const base = (existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing
    : {}) as Record<string, unknown>;
  const section = (
    base[providerNamespace] &&
    typeof base[providerNamespace] === "object" &&
    !Array.isArray(base[providerNamespace])
      ? base[providerNamespace]
      : {}
  ) as Record<string, unknown>;
  return {
    ...base,
    [providerNamespace]: { ...section, ...patch },
  } as Prisma.InputJsonObject;
}

/** Prisma P2002, without a runtime dependency on the generated client. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
