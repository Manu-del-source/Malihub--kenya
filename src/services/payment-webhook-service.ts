import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  createPaystackClient,
  resolvePaystackConfig,
  verifyPaystackWebhookSignature,
  type PaystackClient,
  type PaystackConfigSource,
  type PaystackWebhookData,
} from "@/lib/payments/paystack";
import { logAuditEvent } from "@/services/audit-service";
import {
  claimPaymentSuccess,
  isUniqueViolation,
  markOrderPaidForPayment,
  PAYMENT_SYSTEM_ACTOR_ID,
  settleSuccessfulPayment,
  type OrderPaidOutcome,
  type PaymentStore,
} from "@/services/payment-service";

/**
 * Paystack webhook pipeline — the ONLY code that turns a Paystack callback
 * into financial state.
 *
 * ─── Trust model (read before editing) ────────────────────────────────────
 * A webhook is a CLAIM, not an instruction. Four independent gates stand
 * between a claim and money state, and a forged or corrupted delivery fails
 * at least one of them:
 *
 *   1. **Signature** — `x-paystack-signature` must be the hex-encoded
 *      HMAC-SHA512 of the EXACT raw request body keyed with our
 *      `PAYSTACK_SECRET_KEY` (Paystack's documented scheme). Verified with a
 *      constant-time comparison over the raw bytes, before anything is
 *      parsed or persisted. An unverifiable delivery is rejected (401) and
 *      leaves no trace — recording unauthenticated bytes is log noise, not
 *      forensics.
 *   2. **Identity** — `data.reference` must resolve to a REAL `Payment` row
 *      WE created before contacting the provider (PAYSTACK provider, by
 *      customerReference, with the provider-echoed reference and transaction
 *      id as corroborating keys). References are unguessable `MH-…` values;
 *      a callback naming one we never issued is recorded and ignored.
 *   3. **Amount & currency** — the callback's `amount` must EQUAL
 *      `Payment.amountCents` exactly (integer minor units, no floats
 *      anywhere in the pipeline), in `Payment.currency`. Any deviation — in
 *      either direction — never settles money.
 *   4. **Provider re-verification** — even a signature-valid, reference-
 *      valid, amount-valid callback is re-confirmed against Paystack's own
 *      authenticated API (`GET /transaction/verify/{reference}`) before the
 *      claim runs. The verification answer must also say `success` for the
 *      same reference, amount and currency. A webhook that Paystack cannot
 *      corroborate produces NO settlement, ever.
 *
 * Financial effects on top of that are CONDITIONAL database claims: a
 * payment already settled/failed/cancelled cannot be moved again, the order
 * moves only through the guarded state machine, and one effective successful
 * payment per order is enforced under the order-keyed advisory lock inside
 * `claimPaymentSuccess`.
 *
 * Delivery is deduplicated by the database: the
 * `(provider, providerEventId)` unique constraint on `payment_events` makes
 * a redelivery provably effect-free (Paystack retries failed deliveries for
 * up to 72 hours, so this is a requirement, not a nicety).
 *
 * ─── Processing order ─────────────────────────────────────────────────────
 *   signature → parse+validate → locate payment → amount/currency check →
 *   provider re-verification → ONE transaction { record PaymentEvent +
 *   conditional Payment claim } → commit → post-commit { order transition
 *   via settleSuccessfulPayment, then audit/notification }
 *
 * The event row is written in the SAME transaction as the payment claim, so
 * "we acted on this callback" and "here is the callback" commit or roll back
 * together. The ORDER transition is a second step after commit (see the
 * two-step-settle rationale in `payment-service.ts`).
 *
 * ─── Response philosophy ──────────────────────────────────────────────────
 * Everything well-formed is ACKed with 200 — duplicates, unknown references,
 * mismatches, even verification failures — because the event row already
 * records what we need, the claim is conditional, and Paystack retries
 * anything non-200 (a 4xx/5xx here would burn retries on things that can
 * never change, except a genuine OUR-write-failure 500). 401 means the
 * signature did not verify; 400 means the body is not the documented shape.
 * Neither writes anything.
 */

export type PaystackWebhookOutcome =
  /** Signature missing/invalid or provider not configured → route answers 401. Nothing stored. */
  | { kind: "invalid_signature" }
  /** Body is not the documented envelope → route answers 400, nothing stored. */
  | { kind: "invalid_payload" }
  /** Same provider event id already recorded → ACK, zero new effect. */
  | { kind: "duplicate" }
  /** Reference never issued by MaliHub → event recorded, ACK, no transition. */
  | { kind: "unknown_reference" }
  /** Callback amount disagrees with the authoritative payment → recorded + audited. */
  | { kind: "amount_mismatch" }
  /** Callback currency disagrees with the authoritative payment → recorded + audited. */
  | { kind: "currency_mismatch" }
  /**
   * Signature valid but Paystack's own API could not corroborate the
   * success (unreachable, or reports a different status/amount/reference).
   * Recorded + audited, and NEVER settled.
   */
  | { kind: "verification_failed"; reason: string }
  /**
   * Well-formed but already superseded — the payment was already terminal or
   * a sibling attempt already settled the order. The event is still recorded;
   * the first outcome stands and no second financial effect is produced.
   */
  | {
      kind: "ignored";
      reason: "payment_already_terminal" | "contradicts_terminal_state" | "order_already_settled";
    }
  /** Event recorded; the event type does not move money (e.g. refunds, billing). */
  | { kind: "recorded_only"; event: string }
  /** Applied: payment claimed SUCCESS + order transition attempted. */
  | {
      kind: "processed";
      result: "SUCCESS";
      orderChanged: boolean;
      anomaly?: OrderPaidOutcome["anomaly"];
    };

type PaymentRowLike = {
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

/** The event type that means "money collected" in Paystack's vocabulary. */
export const PAYSTACK_SUCCESS_EVENT = "charge.success";

/**
 * The deterministic provider event id. `${event}:${transactionId}` is stable
 * across redeliveries of the SAME event for the SAME transaction, while
 * distinct events for the same transaction (a billing event before
 * `charge.success`) keep distinct ids — exactly the shape the
 * `(provider, providerEventId)` unique constraint needs. When the payload
 * carries no transaction id, the payload hash is the fallback id.
 */
export function paystackEventId(event: string, data: unknown, payloadHash: string): string {
  const id =
    data && typeof data === "object" && "id" in data && data.id != null
      ? String(data.id)
      : null;
  return `paystack:${event}:${id ?? payloadHash}`;
}

/** SHA-256 of the canonical payload — tamper evidence + dedup fallback. */
function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const PAYMENT_WEBHOOK_SELECT = {
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

type WebhookInput = {
  /** The EXACT raw request body bytes (as text) — signature is computed over these. */
  rawBody: string;
  /** The `x-paystack-signature` header value, or null when absent. */
  signature: string | null;
  /** Test seam: inject a stubbed provider client. */
  client?: PaystackClient;
  /** Test seam: explicit environment. Defaults to `process.env`. */
  env?: PaystackConfigSource;
};

/**
 * Processes one signed Paystack webhook delivery end to end. See the module
 * docstring for the trust model and the processing order.
 */
export async function handlePaystackWebhook(
  db: PaymentStore,
  input: WebhookInput
): Promise<PaystackWebhookOutcome> {
  // ── 0. Configuration. Without a valid secret key we CANNOT verify a
  //    signature, so every delivery is unverifiable and refused. Fail closed.
  // `process.env` carries the documented PAYSTACK_* variables at runtime; the
  // cast narrows the Node type to the seam this service documents.
  const env: PaystackConfigSource = input.env ?? (process.env as PaystackConfigSource);
  const config = resolvePaystackConfig(env);
  if (!config.ok) {
    console.error("[payments] Paystack webhook refused: provider not configured", {
      missing: config.missing,
      invalid: config.invalid,
    });
    return { kind: "invalid_signature" };
  }

  // ── 1. Signature — before anything else, over the raw bytes. ────────────
  if (!verifyPaystackWebhookSignature(input.rawBody, input.signature, config.config.secretKey)) {
    console.warn("[payments] Paystack webhook signature verification failed");
    return { kind: "invalid_signature" };
  }

  // ── 2. Shape validation. The payload is a claim, and only a claim. ──────
  let payload: { event: string; data: PaystackWebhookData };
  try {
    const parsed: unknown = JSON.parse(input.rawBody);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).event !== "string" ||
      !(parsed as Record<string, unknown>).event ||
      !(parsed as Record<string, unknown>).data ||
      typeof (parsed as Record<string, unknown>).data !== "object" ||
      Array.isArray((parsed as Record<string, unknown>).data)
    ) {
      throw new Error("not the documented envelope");
    }
    payload = parsed as { event: string; data: PaystackWebhookData };
  } catch {
    console.warn("[payments] Paystack webhook failed envelope validation");
    return { kind: "invalid_payload" };
  }

  const { event, data } = payload;
  const payloadHash = hashPayload(payload);
  const providerEventId = paystackEventId(event, data, payloadHash);
  const reference =
    typeof data.reference === "string" && data.reference ? data.reference : null;
  const transactionId =
    data.id != null && Number.isSafeInteger(data.id) ? String(data.id) : null;
  const redactedPayload = redactPaystackWebhook(payload);

  // ── 3. Events that do not move money are recorded for the audit trail and
  //    ACKed. Refunds belong to the refund phase; billing/subscription events
  //    are out of scope for collection. Recording (with dedup) keeps the
  //    `payment_events` table the single source of "what did the provider
  //    send".
  if (event !== PAYSTACK_SUCCESS_EVENT) {
    const recorded = await recordEvent(db, {
      paymentId: null,
      providerEventId,
      eventType: event,
      payloadHash,
      redactedPayload,
      processingStatus: "PROCESSED",
    });
    if (!recorded) return { kind: "duplicate" };
    return { kind: "recorded_only", event };
  }

  // ── 4. Locate the payment. Lookups use only keys WE assigned or the
  //    provider echoed — never free-form client input:
  //
  //   a. `customerReference === data.reference` — our reference, handed to
  //      Paystack at initiation, echoed back unchanged in the documented
  //      happy path. The authoritative match.
  //   b. `providerTransactionId === String(data.id)` — Paystack's own
  //      transaction id, persisted once the settlement identifies it (or
  //      backfilled by a sibling settlement).
  //   c. `metadata.paystack.providerReference === data.reference` — the
  //      provider-echoed reference persisted at initiation, for the edge
  //      case where Paystack regenerated the reference.
  //
  // (b) and (c) are trusted only when they agree with (a) or land on the
  // SAME row — a near-miss is recorded as an anomaly with no financial
  // effect.
  let payment: PaymentRowLike | null = null;
  let disagreement: { candidateId: string; via: "transaction_id" | "provider_reference" } | null =
    null;

  const byReference = reference
    ? ((await db.payment.findFirst({
        where: { customerReference: reference, provider: "PAYSTACK" },
        orderBy: { createdAt: "desc" },
        select: PAYMENT_WEBHOOK_SELECT,
      })) as unknown as PaymentRowLike | null)
    : null;

  if (byReference) {
    payment = byReference;
  }

  if (!payment && transactionId) {
    const byTransactionId = ((await db.payment.findUnique({
      where: { providerTransactionId: transactionId },
      select: PAYMENT_WEBHOOK_SELECT,
    })) as unknown as PaymentRowLike | null);
    if (byTransactionId && byTransactionId.provider === "PAYSTACK") {
      if (!reference || byTransactionId.customerReference === reference) {
        payment = byTransactionId;
      } else {
        disagreement = { candidateId: byTransactionId.id, via: "transaction_id" };
      }
    }
  }

  if (!payment && !disagreement && reference) {
    const byProviderReference = ((await db.payment.findFirst({
      where: {
        provider: "PAYSTACK",
        metadata: { path: ["paystack", "providerReference"], equals: reference },
      },
      orderBy: { createdAt: "desc" },
      select: PAYMENT_WEBHOOK_SELECT,
    })) as unknown as PaymentRowLike | null);
    if (byProviderReference) {
      payment = byProviderReference;
    }
  }

  // ── 5. Unknown or internally inconsistent reference: record and ACK.
  //    `PaymentEvent.paymentId` is nullable by design for exactly this case —
  //    stranger callbacks are recorded, not dropped.
  if (!payment) {
    const recorded = await recordEvent(db, {
      paymentId: disagreement ? disagreement.candidateId : null,
      providerEventId,
      eventType: event,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
    });
    if (!recorded) return { kind: "duplicate" };
    if (disagreement) {
      await logAuditEvent({
        action: "payment.anomaly",
        actorId: PAYMENT_SYSTEM_ACTOR_ID,
        targetType: "payment",
        targetId: disagreement.candidateId,
        metadata: {
          provider: "PAYSTACK",
          anomaly: "reference_mismatch",
          via: disagreement.via,
          reportedReference: reference,
          source: "paystack:webhook",
        },
      }).catch(() => undefined);
    }
    console.warn("[payments] Paystack webhook did not match an expected payment", {
      disagreement: Boolean(disagreement),
    });
    return { kind: "unknown_reference" };
  }

  // ── 6. Amount & currency, in integer minor units, against OUR row. A
  //    callback claiming any other amount or currency never settles money, in
  //    either direction (under-payment AND over-payment).
  if (!Number.isSafeInteger(data.amount) || data.amount !== payment.amountCents) {
    const recorded = await recordEvent(db, {
      paymentId: payment.id,
      providerEventId,
      eventType: event,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
    });
    if (!recorded) return recoveredDuplicate(db, payment.id);
    await logAuditEvent({
      action: "payment.amount_mismatch",
      actorId: PAYMENT_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYSTACK",
        orderId: payment.orderId,
        customerReference: payment.customerReference,
        expectedAmountCents: payment.amountCents,
        reportedAmount: Number.isFinite(data.amount) ? data.amount : null,
        source: "paystack:webhook",
      },
    }).catch(() => undefined);
    return { kind: "amount_mismatch" };
  }

  if (typeof data.currency !== "string" || data.currency !== payment.currency) {
    const recorded = await recordEvent(db, {
      paymentId: payment.id,
      providerEventId,
      eventType: event,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
    });
    if (!recorded) return recoveredDuplicate(db, payment.id);
    await logAuditEvent({
      action: "payment.amount_mismatch",
      actorId: PAYMENT_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYSTACK",
        orderId: payment.orderId,
        customerReference: payment.customerReference,
        expectedCurrency: payment.currency,
        reportedCurrency: typeof data.currency === "string" ? data.currency : null,
        source: "paystack:webhook",
      },
    }).catch(() => undefined);
    return { kind: "currency_mismatch" };
  }

  // ── 7. Provider re-verification — the authoritative confirmation. Even a
  //    signature-valid callback is only a hint; Paystack's own API decides.
  //    The verify call is idempotent and side-effect-free, so retries are safe.
  const client = input.client ?? createPaystackClient(config.config);
  const lookupReference = reference ?? payment.customerReference;
  let verified: Awaited<ReturnType<PaystackClient["verifyTransaction"]>> | null = null;
  try {
    verified = await client.verifyTransaction(lookupReference);
  } catch (error) {
    const recorded = await recordEvent(db, {
      paymentId: payment.id,
      providerEventId,
      eventType: event,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
    });
    if (!recorded) return recoveredDuplicate(db, payment.id);
    const reason =
      error instanceof Error ? error.message.slice(0, 300) : "provider verification error";
    console.error("[payments] Paystack webhook could not be corroborated by the provider API", {
      paymentId: payment.id,
    });
    await logAuditEvent({
      action: "payment.verification_failed",
      actorId: PAYMENT_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYSTACK",
        orderId: payment.orderId,
        customerReference: payment.customerReference,
        reference: lookupReference,
        reason,
        source: "paystack:webhook",
      },
    }).catch(() => undefined);
    return { kind: "verification_failed", reason };
  }

  if (
    verified.status !== "success" ||
    verified.reference !== lookupReference ||
    verified.amount !== payment.amountCents ||
    verified.currency !== payment.currency
  ) {
    const recorded = await recordEvent(db, {
      paymentId: payment.id,
      providerEventId,
      eventType: event,
      payloadHash,
      redactedPayload,
      processingStatus: "FAILED",
    });
    if (!recorded) return recoveredDuplicate(db, payment.id);
    const reason =
      verified.status !== "success"
        ? `provider status "${verified.status}"`
        : verified.amount !== payment.amountCents
          ? `provider amount ${verified.amount} != expected ${payment.amountCents}`
          : verified.currency !== payment.currency
            ? `provider currency "${verified.currency}" != expected "${payment.currency}"`
            : "provider reference mismatch";
    console.error("[payments] Paystack verification did not corroborate the webhook", {
      paymentId: payment.id,
      reason,
    });
    await logAuditEvent({
      action: "payment.verification_failed",
      actorId: PAYMENT_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYSTACK",
        orderId: payment.orderId,
        customerReference: payment.customerReference,
        reference: lookupReference,
        reason,
        source: "paystack:webhook",
      },
    }).catch(() => undefined);
    return { kind: "verification_failed", reason };
  }

  // ── 8. One transaction: record the event + claim the payment. ───────────
  type TxOutcome =
    | { kind: "claimed"; payment: PaymentRowLike }
    | {
        kind: "superseded";
        reason: "payment_already_terminal" | "contradicts_terminal_state" | "order_already_settled";
      };

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
          provider: "PAYSTACK",
          providerEventId,
          eventType: event,
          payloadHash,
          rawPayload: redactedPayload as Prisma.InputJsonValue,
          processingStatus: "RECEIVED",
        },
      });

      const claim = await claimPaymentSuccess(
        tx,
        payment,
        {
          providerReference: verified.reference,
          providerTransactionId: transactionId ?? undefined,
        },
        payload
      );
      if (claim === "claimed") {
        await markEventProcessed(tx, providerEventId);
        return { kind: "claimed", payment };
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
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost the delivery race: a concurrent invocation of this same webhook
      // already recorded the event. Its claims are the ones that committed;
      // this delivery is definitionally effect-free — EXCEPT that "effect-
      // free" must also mean "the order transition survived", so a replay
      // opportunistically closes the two-step settle's crash window.
      return recoveredDuplicate(db, payment.id);
    }
    throw error;
  }

  // ── 9. Post-commit effects ───────────────────────────────────────────────
  if (txOutcome.kind === "superseded") {
    if (txOutcome.reason === "contradicts_terminal_state") {
      console.error("[payments] Successful webhook for a payment already terminal", {
        paymentId: payment.id,
      });
    }
    if (txOutcome.reason === "order_already_settled") {
      // A sibling attempt already settled this order; this webhook claims
      // the SAME money twice — a possible real double collection. Record the
      // anomaly for reconciliation (its payment row stays untouched, truthful
      // about what WE can prove, and the event row carries the payload
      // forensics).
      console.warn("[payments] Success webhook for an attempt superseded by a sibling", {
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
          source: "paystack:webhook",
        },
      }).catch(() => undefined);
    }
    return { kind: "ignored", reason: txOutcome.reason };
  }

  // Step two + audit trail: the canonical settlement finalizer, shared with
  // status verification. See settleSuccessfulPayment.
  const orderOutcome = await settleSuccessfulPayment(db, txOutcome.payment, {
    source: "paystack:webhook",
    claimedNow: true,
    provider: "PAYSTACK",
  });
  return {
    kind: "processed",
    result: "SUCCESS",
    orderChanged: orderOutcome.orderChanged,
    anomaly: orderOutcome.anomaly,
  };
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
  paymentId: string
): Promise<{ kind: "duplicate" }> {
  const fresh = (await db.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, orderId: true, amountCents: true, status: true },
  })) as { id: string; orderId: string; amountCents: number; status: string } | null;
  if (fresh?.status === "SUCCESS") {
    await markOrderPaidForPayment(db, fresh, "paystack:webhook-replay");
  }
  return { kind: "duplicate" };
}

type EventRecord = {
  paymentId: string | null;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  redactedPayload: Record<string, unknown>;
  processingStatus: "PROCESSED" | "IGNORED" | "FAILED";
};

/**
 * Records a standalone event (unknown reference / mismatch), returning false
 * when the event id was already taken — i.e. it treats the payment-event
 * unique constraint as the dedup boundary exactly like the main pipeline.
 */
async function recordEvent(db: PaymentStore, record: EventRecord): Promise<boolean> {
  try {
    await db.paymentEvent.create({
      data: {
        paymentId: record.paymentId,
        provider: "PAYSTACK",
        providerEventId: record.providerEventId,
        eventType: record.eventType,
        payloadHash: record.payloadHash,
        rawPayload: record.redactedPayload as Prisma.InputJsonValue,
        processingStatus: record.processingStatus,
        processedAt: new Date(),
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
    where: { provider: "PAYSTACK", providerEventId },
    data: { processingStatus: "PROCESSED", processedAt: new Date() },
  });
}

async function markEventIgnored(
  tx: { paymentEvent: PaymentStore["paymentEvent"] },
  providerEventId: string
): Promise<void> {
  await tx.paymentEvent.updateMany({
    where: { provider: "PAYSTACK", providerEventId },
    data: { processingStatus: "IGNORED", processedAt: new Date() },
  });
}

/**
 * Fields stripped from a webhook before it is persisted as
 * `PaymentEvent.rawPayload` — the redacted copy kept for reconciliation. The
 * customer object carries payer PII (names, phone) the event log does not
 * need; the VERBATIM payload is stored on `Payment.rawCallbackPayload` only
 * when the settlement actually claims, exactly as that field documents.
 *
 * Returns a NEW object; the input is never mutated.
 */
export function redactPaystackWebhook(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const redacted = structuredClone(payload) as Record<string, unknown>;
  const data = redacted.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer && typeof customer === "object") {
      if (customer.phone != null) customer.phone = "[redacted]";
      if (customer.first_name != null) customer.first_name = "[redacted]";
      if (customer.last_name != null) customer.last_name = "[redacted]";
      if (customer.international_format_phone != null) {
        customer.international_format_phone = "[redacted]";
      }
    }
  }
  return redacted;
}
