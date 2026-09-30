import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  payheroCallbackSchema,
  redactPayheroCallback,
  type PayheroCallbackPayload,
} from "@/lib/payments/payhero";
import { logAuditEvent } from "@/services/audit-service";
import {
  afterPaymentFailureRecorded,
  claimPaymentFailure,
  claimPaymentSuccess,
  markOrderPaidForPayment,
  PAYHERO_SYSTEM_ACTOR_ID,
  settleSuccessfulPayment,
  type OrderPaidOutcome,
  type PaymentStore,
} from "@/services/payment-service";

/**
 * PayHero STK callback pipeline — the only code that turns a provider callback
 * into financial state.
 *
 * ─── Why an unsigned callback is still safe here ────────────────────────────
 * PayHero documents NO HMAC/signature for its callbacks, and this service
 * invents none. Security is instead layered on facts an attacker cannot
 * produce:
 *
 *   1. `ExternalReference` must resolve to a REAL Payment row we created and
 *      persisted BEFORE any provider call. References are unguessable
 *      (`MH-XXXXXXXX` from a 30-character alphabet to begin with), and a
 *      callback naming one we never issued is recorded and ignored — the
 *      database, not the payload, establishes the expected payment.
 *   2. The callback amount must EQUAL `Payment.amountCents` exactly (integer
 *      minor units, no floating point anywhere in the pipeline).
 *   3. Financial effects are CONDITIONAL database claims: a payment already
 *      settled/failed/cancelled cannot be moved again, and the order moves
 *      only through `markOrderPaid`'s compare-and-swap inside the state
 *      machine.
 *   4. Delivery is deduplicated by the database: the
 *      `(provider, providerEventId)` unique constraint on `payment_events`
 *      makes a redelivery provably effect-free.
 *
 * ─── Processing order (read before editing) ────────────────────────────────
 *   parse+validate → locate payment → amount check → classify outcome →
 *   ONE transaction { record PaymentEvent + conditional Payment claim } →
 *   commit → post-commit { order transition via markOrderPaid, then
 *   audit/notification }
 *
 * The event row is written in the SAME transaction as the payment claim, so
 * "we acted on this callback" and "here is the callback" commit or roll back
 * together. The ORDER transition is a second step after commit (see the
 * two-step-settle rationale in `payment-service.ts`).
 *
 * ─── Response philosophy ───────────────────────────────────────────────────
 * Everything well-formed is ACKed, including duplicates, unknown references
 * and amount anomalies: the event row already records what we need, and a 4xx
 * would invite PayHero retries for things that can never change. Only a
 * structurally invalid payload is a 400, and only OUR OWN failures (database
 * down mid-write) are a 500 — that is the one case where a provider retry is
 * genuinely useful, because nothing committed.
 */

export type PayheroCallbackOutcome =
  /** Body is not the documented envelope → route answers 400, nothing stored. */
  | { kind: "invalid_payload" }
  /** Same provider event id already recorded → ACK, zero new effect. */
  | { kind: "duplicate" }
  /** Reference never issued by MaliHub → event recorded, ACK, no transition. */
  | { kind: "unknown_reference" }
  /** Amount disagrees with the authoritative payment → recorded + audited. */
  | { kind: "amount_mismatch" }
  /** Applied: payment claimed + order transition attempted (success path). */
  | {
      kind: "processed";
      result: "SUCCESS";
      orderChanged: boolean;
      anomaly?: OrderPaidOutcome["anomaly"];
    }
  /** Applied: payment recorded FAILED/CANCELLED; order stays unpaid. */
  | { kind: "processed"; result: "FAILED" | "CANCELLED" }
  /**
   * Well-formed but already superseded — e.g. the payment was already
   * terminal, this callback contradicts an earlier recorded outcome, or a
   * sibling attempt already settled the order. The event is still recorded;
   * the first outcome stands and no second financial effect is produced.
   */
  | {
      kind: "ignored";
      reason: "payment_already_terminal" | "contradicts_terminal_state" | "order_already_settled";
    };

type PaymentRowLike = {
  id: string;
  orderId: string;
  provider: string;
  status: string;
  amountCents: number;
  customerReference: string;
  providerTransactionId: string | null;
  providerReference: string | null;
  metadata: unknown;
};

/**
 * The deterministic provider event id. CheckoutRequestID is present in every
 * documented STK callback AND was persisted at initiation — it is immutable
 * and unique per STK transaction, which is exactly what a dedup key needs.
 * (MpesaReceiptNumber is missing on failure callbacks; MerchantRequestID is
 * not a documented per-event id; timestamps/randomness would defeat dedup.)
 *
 * One transaction produces one terminal STK result callback, so a redelivery
 * of that result collapses onto the same id — and a *contradictory* second
 * "result" for the same transaction is treated as what it is: an anomaly that
 * must not apply a second effect (the first outcome stands).
 */
export function payheroStkEventId(checkoutRequestId: string): string {
  return `stk-callback:${checkoutRequestId}`;
}

/** SHA-256 of the canonical payload — tamper evidence + payload-level dedup aid. */
function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function handlePayheroCallback(
  db: PaymentStore,
  rawBody: unknown
): Promise<PayheroCallbackOutcome> {
  // ── 1. Shape validation. The payload is a claim, and only a claim. ─────────
  const parsed = payheroCallbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    console.warn("[payments] PayHero callback failed schema validation");
    return { kind: "invalid_payload" };
  }
  const payload: PayheroCallbackPayload = parsed.data;
  const { response } = payload;

  const eventType = response.Status;
  const providerEventId = payheroStkEventId(response.CheckoutRequestID);
  const payloadHash = hashPayload(rawBody);
  const redactedPayload = redactPayheroCallback(payload);

  // ── 2. Locate the payment. Two lookup keys WE assigned, never client input:
  //
  //   a. `providerTransactionId` (PayHero's CheckoutRequestID, persisted at
  //      initiation, unique) — the authoritative match. The callback's
  //      ExternalReference must then agree with the row's customer reference,
  //      or the payload is internally inconsistent.
  //   b. `customerReference` — the fallback for the crash window where the
  //      initiation completed provider-side but we never recorded the id.
  //      Trusted only when the row has no transaction id yet OR the id it has
  //      is the callback's own (the double-prompt race: the callback of the
  //      STK push whose id LOST the claim must not settle the winner's row).
  //
  // A near-miss id is retained (`danglingCandidateId`) so the event row can
  // point forensics at the row a human should look at — while applying no
  // financial effect whatsoever.
  let payment: PaymentRowLike | null = null;
  let danglingCandidateId: string | null = null;

  const byTransactionId = (await db.payment.findUnique({
    where: { providerTransactionId: response.CheckoutRequestID },
    select: PAYMENT_CALLBACK_SELECT,
  })) as unknown as PaymentRowLike | null;

  if (byTransactionId && byTransactionId.provider === "PAYHERO") {
    if (byTransactionId.customerReference === response.ExternalReference) {
      payment = byTransactionId;
    } else {
      danglingCandidateId = byTransactionId.id;
    }
  }

  if (!payment && !danglingCandidateId) {
    const byReference = (await db.payment.findFirst({
      where: { customerReference: response.ExternalReference, provider: "PAYHERO" },
      orderBy: { createdAt: "desc" },
      select: PAYMENT_CALLBACK_SELECT,
    })) as unknown as PaymentRowLike | null;

    if (byReference) {
      if (
        byReference.providerTransactionId === null ||
        byReference.providerTransactionId === response.CheckoutRequestID
      ) {
        payment = byReference;
      } else {
        danglingCandidateId = byReference.id;
      }
    }
  }

  // ── 3. Unknown or inconsistent reference: record and ACK.
  //    `PaymentEvent.paymentId` is nullable by design for exactly this
  //    case — the schema demands stranger-callbacks be recorded, not dropped.
  if (!payment) {
    const recorded = await recordEvent(db, {
      paymentId: danglingCandidateId,
      providerEventId,
      eventType,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
      processed: true,
    });
    if (!recorded) return { kind: "duplicate" };
    console.warn("[payments] PayHero callback did not match an expected payment", {
      danglingCandidate: Boolean(danglingCandidateId),
    });
    return { kind: "unknown_reference" };
  }

  // ── 4. Amount check, in integer minor units, against OUR row. A callback
  //    claiming any other amount never settles money, in either direction.
  const callbackKes = response.Amount;
  const amountMatches =
    Number.isSafeInteger(callbackKes) && callbackKes * 100 === payment.amountCents;

  if (!amountMatches) {
    const recorded = await recordEvent(db, {
      paymentId: payment.id,
      providerEventId,
      eventType,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
      processed: true,
    });
    if (!recorded) return recoveredDuplicate(db, payment);

    await logAuditEvent({
      action: "payment.amount_mismatch",
      actorId: PAYHERO_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYHERO",
        orderId: payment.orderId,
        customerReference: payment.customerReference,
        expectedAmountCents: payment.amountCents,
        reportedAmountKes: Number.isFinite(callbackKes) ? callbackKes : null,
        statusReported: eventType,
      },
    }).catch(() => undefined);

    return { kind: "amount_mismatch" };
  }

  // ── 5. Classify the provider result. Success requires BOTH the documented
  //    success word and ResultCode 0; anything else is a non-collection.
  const isSuccess = response.Status === "Success" && response.ResultCode === 0;

  // ── 6. One transaction: record the event + claim the payment. ─────────────
  type TxOutcome =
    | { kind: "claimed_success"; payment: PaymentRowLike }
    | { kind: "claimed_failure"; to: "FAILED" | "CANCELLED"; payment: PaymentRowLike }
    | {
        kind: "superseded";
        reason: "payment_already_terminal" | "contradicts_terminal_state" | "order_already_settled";
      }
    | { kind: "duplicate" };

  let txOutcome: TxOutcome;
  try {
    txOutcome = await db.$transaction<TxOutcome>(async (tx) => {
      // The idempotency primitive: the (provider, providerEventId) unique
      // constraint. A redelivery hits P2002 on this insert and rolls back
      // BEFORE any claim runs — the database, not application memory, is the
      // guarantee that callback #2 and callback #3 have no second effect.
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider: "PAYHERO",
          providerEventId,
          eventType,
          payloadHash,
          rawPayload: redactedPayload as Prisma.InputJsonValue,
          processingStatus: "RECEIVED",
        },
      });

      if (isSuccess) {
        const claim = await claimPaymentSuccess(
          tx,
          payment,
          {
            providerReference: response.MpesaReceiptNumber ?? null,
            merchantRequestId: response.MerchantRequestID ?? null,
            checkoutRequestId: response.CheckoutRequestID,
          },
          rawBody
        );
        if (claim === "claimed") {
          await markEventProcessed(tx, providerEventId);
          return { kind: "claimed_success", payment };
        }
        await markEventIgnored(tx, providerEventId);
        return {
          kind: "superseded",
          reason:
            claim === "superseded"
              ? "order_already_settled"
              : claim === "already_success"
                ? "payment_already_terminal"
                : "contradicts_terminal_state",
        };
      }

      const failure = classifyFailure(response.Status, response.ResultCode);
      const claim = await claimPaymentFailure(
        tx,
        payment,
        {
          to: failure.to,
          code: String(response.ResultCode),
          reason: response.ResultDesc?.slice(0, 500) ?? null,
        },
        rawBody
      );
      if (claim === "claimed") {
        await markEventProcessed(tx, providerEventId);
        return { kind: "claimed_failure", to: failure.to, payment };
      }
      await markEventIgnored(tx, providerEventId);
      return { kind: "superseded", reason: "payment_already_terminal" };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost the delivery race: a concurrent invocation of this same callback
      // already recorded the event. Its claims are the ones that committed;
      // this delivery is definitionally effect-free — EXCEPT that "effect-
      // free" must also mean "the order transition survived", so a replay
      // opportunistically closes the two-step settle's crash window.
      return recoveredDuplicate(db, payment);
    }
    throw error;
  }

  // ── 7. Post-commit effects ─────────────────────────────────────────────────
  switch (txOutcome.kind) {
    case "duplicate":
      return recoveredDuplicate(db, payment);
    case "superseded":
      if (txOutcome.reason === "contradicts_terminal_state") {
        console.error("[payments] Successful callback for a payment already terminal", {
          paymentId: payment.id,
        });
      }
      if (txOutcome.reason === "order_already_settled") {
        // A sibling attempt already settled this order; this callback claims
        // the SAME money twice — a possible real double collection. Record
        // the anomaly for reconciliation (its payment row stays untouched,
        // truthful about what WE can prove, and the event row carries the
        // payload forensics).
        console.warn("[payments] Success callback for an attempt superseded by a sibling", {
          paymentId: payment.id,
        });
        await logAuditEvent({
          action: "payment.anomaly",
          actorId: PAYHERO_SYSTEM_ACTOR_ID,
          targetType: "payment",
          targetId: payment.id,
          metadata: {
            provider: "PAYHERO",
            orderId: payment.orderId,
            customerReference: payment.customerReference,
            amountCents: payment.amountCents,
            anomaly: "superseded_success",
            source: "payhero:callback",
          },
        }).catch(() => undefined);
      }
      return { kind: "ignored", reason: txOutcome.reason };
    case "claimed_failure": {
      await afterPaymentFailureRecorded(db, txOutcome.payment, "callback", txOutcome.to);
      return { kind: "processed", result: txOutcome.to };
    }
    case "claimed_success": {
      // Step two + audit trail: the canonical settlement finalizer, shared
      // with status verification. See settleSuccessfulPayment.
      const orderOutcome = await settleSuccessfulPayment(db, txOutcome.payment, {
        source: "payhero:callback",
        claimedNow: true,
      });
      return {
        kind: "processed",
        result: "SUCCESS",
        orderChanged: orderOutcome.orderChanged,
        anomaly: orderOutcome.anomaly,
      };
    }
  }
}

/**
 * A duplicate delivery must be both effect-free AND recovery-capable: if the
 * payment is SUCCESS but the order transition died in the crash window
 * (between the claim commit and step two), re-run the idempotent transition.
 * `markOrderPaid` is a no-op for an already-PAID order, so in the common case
 * this is one extra read and nothing else. No audits and no notifications
 * from this path — the original settlement recorded its own.
 */
async function recoveredDuplicate(
  db: PaymentStore,
  payment: { id: string }
): Promise<{ kind: "duplicate" }> {
  const fresh = (await db.payment.findUnique({
    where: { id: payment.id },
    select: { id: true, orderId: true, amountCents: true, status: true },
  })) as { id: string; orderId: string; amountCents: number; status: string } | null;
  if (fresh?.status === "SUCCESS") {
    await markOrderPaidForPayment(db, fresh, "payhero:callback-replay");
  }
  return { kind: "duplicate" };
}

const PAYMENT_CALLBACK_SELECT = {
  id: true,
  orderId: true,
  provider: true,
  status: true,
  amountCents: true,
  customerReference: true,
  providerTransactionId: true,
  providerReference: true,
  metadata: true,
} as const;

/** Daraja result code 1032 = the customer cancelled the STK prompt. */
const MPESA_USER_CANCELLED_RESULT_CODE = 1032;

function classifyFailure(
  statusWord: string,
  resultCode: number
): { to: "FAILED" | "CANCELLED" } {
  if (
    resultCode === MPESA_USER_CANCELLED_RESULT_CODE ||
    /^cancelled?$/i.test(statusWord.trim())
  ) {
    return { to: "CANCELLED" };
  }
  return { to: "FAILED" };
}

type EventRecord = {
  paymentId: string | null;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  redactedPayload: Record<string, unknown>;
  processingStatus: "PROCESSED" | "IGNORED" | "FAILED";
  processed: boolean;
};

/**
 * Records a standalone event (unknown reference / amount anomaly), returning
 * false when the event id was already taken — i.e. it treats the payment-event
 * unique constraint as the dedup boundary exactly like the main pipeline.
 */
async function recordEvent(db: PaymentStore, record: EventRecord): Promise<boolean> {
  try {
    await db.paymentEvent.create({
      data: {
        paymentId: record.paymentId,
        provider: "PAYHERO",
        providerEventId: record.providerEventId,
        eventType: record.eventType,
        payloadHash: record.payloadHash,
        rawPayload: record.redactedPayload as Prisma.InputJsonValue,
        processingStatus: record.processingStatus,
        ...(record.processed ? { processedAt: new Date() } : {}),
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function markEventProcessed(
  tx: { paymentEvent: PaymentStore["paymentEvent"] },
  providerEventId: string
): Promise<void> {
  await tx.paymentEvent.updateMany({
    where: { provider: "PAYHERO", providerEventId },
    data: { processingStatus: "PROCESSED", processedAt: new Date() },
  });
}

async function markEventIgnored(
  tx: { paymentEvent: PaymentStore["paymentEvent"] },
  providerEventId: string
): Promise<void> {
  await tx.paymentEvent.updateMany({
    where: { provider: "PAYHERO", providerEventId },
    data: { processingStatus: "IGNORED", processedAt: new Date() },
  });
}

/** Prisma P2002, without a runtime dependency on the generated client. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
