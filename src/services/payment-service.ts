import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createPayheroClient,
  PayheroClientError,
  resolvePayheroConfig,
  type PayheroClient,
  type PayheroConfigSource,
} from "@/lib/payments/payhero";
import { kenyanPhoneRegex } from "@/lib/validations/payment";
import {
  assertPaymentTransition,
  CLAIMABLE_PAYMENT_STATUSES,
} from "@/lib/payment-state-machine";
import { toKenyanMsisdn } from "@/utils";
import { logAuditEvent } from "@/services/audit-service";
import { notifyUser } from "@/services/notification-service";
import { markOrderPaid, OrderTransitionError } from "@/services/order-transition-service";

/**
 * Payment collection — PayHero M-Pesa STK Push (Phase 9.2-A).
 *
 * ─── What this service owns ────────────────────────────────────────────────
 *  1. `initiatePayheroStk()`        — collecting a PENDING order: payment row,
 *                                     PayHero STK push, identifier persistence.
 *  2. Settlement primitives         — the conditional Payment claims both
 *                                     trusted success channels share.
 *  3. `verifyPayheroPaymentStatus()`— transaction-status verification/recovery.
 *
 * The inbound callback pipeline lives in `payment-callback-service.ts`; both
 * funnel into the SAME claim + order-transition primitives here, so the two
 * channels can never disagree about what "paid" means.
 *
 * ─── Trust boundaries (the whole point of the flow) ────────────────────────
 *  - The amount comes from `Payment.amountCents`, copied at creation from
 *    `Order.totalCents` read inside the transaction — never from a request.
 *  - `channel_id`, `provider` and `callback_url` come from server config —
 *    never from a client.
 *  - `external_reference` is OUR value (`Payment.customerReference`),
 *    persisted BEFORE PayHero is called, and echoed back unchanged in the
 *    callback. It is what correlates a callback to a payment without trusting
 *    any client-provided id.
 *  - A PayHero "QUEUED" answer means the STK prompt was accepted. It is NOT a
 *    collected payment and nothing here treats it as one.
 *
 * ─── Identifier mapping (existing schema fields, no new columns) ────────────
 *  - `Payment.customerReference`      ← our `external_reference`. Attempt 1 is
 *    the order number (`MH-…`); retry attempt N is the deterministic
 *    `MH-…-RN`, so every payment attempt carries a unique reference.
 *  - `Payment.providerTransactionId`  ← PayHero `CheckoutRequestID` (unique;
 *    the schema's own Daraja precedent — PayHero fronts M-Pesa's STK API).
 *  - `Payment.providerReference`      ← M-Pesa receipt (`MpesaReceiptNumber`),
 *    the settlement reference a customer can quote (unique).
 *  - `Payment.metadata.payhero`       ← PayHero's own `reference` (the
 *    transaction-status lookup key) and `merchantRequestId`. Provider-specific
 *    and opaque, exactly what `metadata` is for.
 *  - `Payment.payerReference`         ← normalized payer MSISDN (payer handle;
 *    never logged).
 *  - `Payment.rawCallbackPayload`     ← the VERBATIM callback body, as that
 *    field documents. The redacted copy goes to `PaymentEvent.rawPayload`.
 *
 * ─── Retry & concurrency semantics (Phase 9.3) ─────────────────────────────
 * One payment attempt is ever ACTIVE (PENDING/PROCESSING) per order, and the
 * initiation transaction takes a Postgres advisory lock keyed on the order id
 * (`pg_advisory_xact_lock(hashtext(orderId))`) so two concurrent STK requests
 * for the same order serialize and the loser adopts the winner's attempt
 * instead of creating a second one. A FAILED/CANCELLED attempt is never
 * mutated: a retry creates a NEW Payment row with `retryCount + 1` and a new
 * deterministic customer reference, per the schema's attempt model. Attempt
 * creation is additionally capped (`MAX_PAYMENT_ATTEMPTS_PER_ORDER`) — a
 * bounded number of pushes per order, so a scripted buyer cannot hold the
 * provider's (and our) line open forever. Joining/resuming an ACTIVE attempt
 * is never blocked by the cap; only creating a NEW one is.
 *
 * ─── One effective successful payment per order ────────────────────────────
 * Two attempts can both be provider-visible (a prompt the buyer pays after we
 * recorded a cancellation, an STK we timed out on that succeeded anyway),
 * and each can attract a success callback. Only ONE may ever settle the
 * order: the success claim runs under the SAME order-keyed advisory lock
 * initiation uses, so concurrent success claims for sibling attempts
 * serialize, and the loser observes the winner's committed SUCCESS sibling
 * and is refused (`"superseded"`). The order's own `PENDING → PAID`
 * transition is a conditional claim regardless — two layers, no schema
 * changes.
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
 *  - a duplicate-provider-event replay (`handlePayheroCallback` recovers
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
  | "profile"
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
 * initiation/select shape and the callback pipeline's lighter select satisfy
 * it, so neither side has to over-fetch (or cast) to settle.
 */
export type SettleablePaymentRow = {
  id: string;
  orderId: string;
  status: string;
  amountCents: number;
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
  /** The order total cannot be represented in whole KES for this provider. */
  | "invalid_amount"
  /** No phone number was provided and the account has none. */
  | "phone_required"
  /** The phone number failed the project's Kenyan-number validation. */
  | "phone_invalid"
  /** Required PAYHERO_* environment variables are missing or invalid. */
  | "provider_not_configured"
  /** PayHero actively refused the request (4xx / success:false). */
  | "provider_rejected"
  /** PayHero 5xx, network failure, or timeout. */
  | "provider_unavailable"
  /** A 2xx answer that did not match the documented shape. */
  | "provider_invalid_response"
  /**
   * The order has used up its payment attempts. Bounded retries are a
   * deliberate abuse control (Phase 9.3): a healthy buyer succeeds within a
   * few attempts, and beyond the cap STK pushes stop until a human looks.
   */
  | "attempt_limit";

export class PaymentServiceError extends Error {
  readonly code: PaymentServiceErrorCode;

  constructor(message: string, code: PaymentServiceErrorCode) {
    super(message);
    this.name = "PaymentServiceError";
    this.code = code;
  }
}

function mapClientError(error: PayheroClientError): PaymentServiceError {
  switch (error.kind) {
    case "http_rejected":
    case "declined":
      return new PaymentServiceError(error.message, "provider_rejected");
    case "invalid_response":
      return new PaymentServiceError(error.message, "provider_invalid_response");
    case "http_error":
    case "network":
    case "timeout":
      return new PaymentServiceError(error.message, "provider_unavailable");
  }
}

function requireClient(
  provided: PayheroClient | undefined,
  env: PayheroConfigSource
): PayheroClient {
  if (provided) return provided;
  const resolved = resolvePayheroConfig(env);
  if (!resolved.ok) {
    console.error("[payments] PayHero is not configured", {
      missing: resolved.missing,
      invalid: resolved.invalid,
    });
    throw new PaymentServiceError(
      "Card/mobile-money collection is not configured on this deployment.",
      "provider_not_configured"
    );
  }
  return createPayheroClient(resolved.config);
}

// ─── Shared types ────────────────────────────────────────────────────────────

/** The metadata namespace this service maintains on `Payment.metadata`. */
type PayheroMetadata = {
  payhero?: {
    reference?: string | null;
    merchantRequestId?: string | null;
    initiationStatus?: string | null;
    anomalies?: string[];
  };
};

function readPayheroMetadata(metadata: unknown): NonNullable<PayheroMetadata["payhero"]> {
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "payhero" in metadata
  ) {
    const section = (metadata as PayheroMetadata).payhero;
    if (section && typeof section === "object") return section;
  }
  return {};
}

function mergePayheroMetadata(
  existing: unknown,
  patch: NonNullable<PayheroMetadata["payhero"]>
): Prisma.InputJsonObject {
  const base = (existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing
    : {}) as Record<string, unknown>;
  return {
    ...base,
    payhero: { ...readPayheroMetadata(existing), ...patch },
  } as Prisma.InputJsonObject;
}

/**
 * A deterministic, globally-unique actor id for system-driven financial
 * events. `audit_logs.actor_id` is a UUID column, so a scheme like
 * `"payhero-callback"` cannot be written to it; the nil UUID is a valid UUID
 * that can never collide with a real user, and `metadata.source` carries the
 * human-readable origin (already the convention in `markOrderPaid`).
 */
export const PAYHERO_SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Hard cap on PayHero attempts per order (Phase 9.3 abuse control). Counting
 * every attempt row for the order — including CANCELLED ones, because a
 * scripted "cancel the prompt, push again" loop must also run out of road.
 * Five is generous for a real buyer who lost signal twice and cancelled once;
 * past it, the order stays payable in every other respect but STK collection
 * stops until a human intervenes. Joining/resuming an ACTIVE attempt never
 * counts — only the creation of a NEW attempt is capped.
 */
export const MAX_PAYMENT_ATTEMPTS_PER_ORDER = 5;

// ─── Payment row shape used across the service ──────────────────────────────

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  provider: true,
  status: true,
  amountCents: true,
  currency: true,
  customerReference: true,
  providerTransactionId: true,
  providerReference: true,
  payerReference: true,
  metadata: true,
  retryCount: true,
  createdAt: true,
} satisfies Prisma.PaymentSelect;

type PaymentRow = {
  id: string;
  orderId: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  customerReference: string;
  providerTransactionId: string | null;
  providerReference: string | null;
  payerReference: string | null;
  metadata: unknown;
  retryCount: number;
  createdAt: Date;
};

// ─── 1. Initiation ───────────────────────────────────────────────────────────

export type InitiateStkParams = {
  /** The session-resolved buyer. Never a request-body value. */
  actor: { userId: string; email: string; accountPhone: string | null };
  orderId: string;
  /** Optional per-request phone override (already zod-validated at the route). */
  phoneNumber?: string;
  /** Test seam: inject a stubbed client. Production resolves from `env`. */
  client?: PayheroClient;
  /** Test seam: explicit environment. Defaults to `process.env`. */
  env?: PayheroConfigSource;
};

export type InitiateStkResult = {
  /** `already_initiated` when an active attempt with a provider id exists. */
  outcome: "initiated" | "already_initiated";
  payment: {
    id: string;
    customerReference: string;
    status: string;
    amountCents: number;
    providerTransactionId: string | null;
  };
};

/**
 * Starts (or joins) the M-Pesa STK collection for a buyer's PENDING order.
 *
 * └ The exact shape: ─────────────────────────────────────────────────────────
 *   tx#1 (advisory-locked on the order):
 *     read order+attempts → guards → create-or-reuse ONE active attempt
 *   PayHero STK push (network, outside any transaction)
 *   tx#2 conditional claim: PENDING + no provider id → PROCESSING + identifiers
 *   post-commit: audit breadcrumb
 *
 * The network call cannot run inside a transaction (a held connection + an
 * external HTTP roundtrip is both a lock-amplification and a timeout hazard),
 * so initiation is "reserve, call, claim". Every stage is idempotent:
 * re-running after a crash resumes the SAME Payment row with the SAME
 * customer reference instead of creating anything new.
 */
export async function initiatePayheroStk(
  db: PaymentStore,
  params: InitiateStkParams
): Promise<InitiateStkResult> {
  const { actor, orderId } = params;
  if (!actor.userId || !orderId) {
    throw new PaymentServiceError("Order not found.", "not_found");
  }

  // ── Phone: request override or the buyer's account number — validated by the
  //    same rule onboarding uses, normalized to MSISDN before PayHero sees it.
  const rawPhone = params.phoneNumber?.trim() || actor.accountPhone?.trim() || "";
  if (!rawPhone) {
    throw new PaymentServiceError(
      "A phone number is required to pay with M-Pesa.",
      "phone_required"
    );
  }
  if (!kenyanPhoneRegex.test(rawPhone)) {
    throw new PaymentServiceError(
      "Enter a valid Kenyan phone number, e.g. 0712345678.",
      "phone_invalid"
    );
  }
  const msisdn = toKenyanMsisdn(rawPhone);

  const client = requireClient(params.client, params.env ?? process.env);

  // ── tx#1: guarded attempt reservation ──────────────────────────────────────
  type Reserved =
    | { kind: "already_initiated"; payment: PaymentRow }
    | { kind: "collect"; payment: PaymentRow; customerName: string | null };

  const reserved: Reserved = await db.$transaction(async (tx) => {
    // Serialize concurrent initiations of the SAME order. The lock is
    // transaction-scoped (auto-released at commit); the loser of a double
    // click then observes the winner's attempt below and adopts it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;

    const order = (await tx.order.findFirst({
      where: { id: orderId, buyerId: actor.userId },
      select: { id: true, orderNumber: true, status: true, totalCents: true },
    })) as { id: string; orderNumber: string; status: string; totalCents: number } | null;

    // "Not yours" and "does not exist" are one answer, so this endpoint can
    // never be used to discover other buyers' order ids.
    if (!order) throw new PaymentServiceError("Order not found.", "not_found");

    if (order.status === "PAID") {
      throw new PaymentServiceError("This order has already been paid.", "already_paid");
    }
    if (order.status !== "PENDING") {
      throw new PaymentServiceError(
        "This order is not awaiting payment.",
        "not_payable"
      );
    }

    // PayHero takes whole-number KES. A total with a cents remainder cannot be
    // collected through this provider without a lossy conversion — refuse
    // loudly rather than round somebody's money.
    if (order.totalCents <= 0 || order.totalCents % 100 !== 0) {
      throw new PaymentServiceError(
        "This order's amount cannot be collected via M-Pesa.",
        "invalid_amount"
      );
    }

    const attempts = (await tx.payment.findMany({
      where: { orderId: order.id, provider: "PAYHERO" },
      orderBy: { createdAt: "desc" },
      select: PAYMENT_SELECT,
    })) as unknown as PaymentRow[];

    const active = attempts.find(
      (attempt) => attempt.status === "PENDING" || attempt.status === "PROCESSING"
    );

    if (active?.providerTransactionId) {
      // A live attempt already reached PayHero. Re-pushing an STK would send
      // the buyer a second prompt for the same money — hand back the existing
      // attempt and let the callback/status-check path finish it.
      return { kind: "already_initiated", payment: active };
    }

    if (active) {
      // A row exists but the provider call never completed (crash/timeout
      // window). RESUME it with the same customer reference — PayHero then
      // echoes a reference that maps back to this exact row.
      const profile = (await tx.profile.findUnique({
        where: { userId: actor.userId },
        select: { fullName: true },
      })) as { fullName: string } | null;
      return { kind: "collect", payment: active, customerName: profile?.fullName ?? null };
    }

    // ── Attempt cap. Every prior attempt is terminal here (an active one was
    //    joined/resumed above), so this is genuinely a NEW attempt — the only
    //    thing the cap governs. Bounded retries: the order stays payable, the
    //    provider line does not stay open.
    if (attempts.length >= MAX_PAYMENT_ATTEMPTS_PER_ORDER) {
      throw new PaymentServiceError(
        "This order has reached the maximum number of payment attempts. Please contact support.",
        "attempt_limit"
      );
    }

    const latest = attempts[0] ?? null;
    const retryCount = latest ? latest.retryCount + 1 : 0;
    const customerReference =
      retryCount === 0 ? order.orderNumber : `${order.orderNumber}-R${retryCount + 1}`;

    const payment = (await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "PAYHERO",
        method: "MOBILE_MONEY",
        status: "PENDING",
        amountCents: order.totalCents,
        currency: "KES",
        customerReference,
        payerReference: msisdn,
        retryCount,
        metadata: { payhero: {} },
      },
      select: PAYMENT_SELECT,
    })) as unknown as PaymentRow;

    const profile = (await tx.profile.findUnique({
      where: { userId: actor.userId },
      select: { fullName: true },
    })) as { fullName: string } | null;

    return { kind: "collect", payment, customerName: profile?.fullName ?? null };
  });

  if (reserved.kind === "already_initiated") {
    return {
      outcome: "already_initiated",
      payment: publicPaymentView(reserved.payment),
    };
  }

  const { payment } = reserved;

  // ── PayHero STK push (network boundary) ────────────────────────────────────
  let stk: Awaited<ReturnType<PayheroClient["initiateStkPush"]>>;
  try {
    stk = await client.initiateStkPush({
      amountKes: payment.amountCents / 100,
      phoneNumber: msisdn,
      externalReference: payment.customerReference,
      ...(reserved.customerName ? { customerName: reserved.customerName } : {}),
    });
  } catch (error) {
    // The Payment row stays PENDING with no provider id: a later initiation
    // resumes it with the same customer reference, so a PayHero-side retry can
    // never fork into a second payment row.
    if (error instanceof PayheroClientError) throw mapClientError(error);
    throw error;
  }

  // ── tx#2: claim the initiation. Conditional on still-PENDING with no
  //    provider id, so the loser of a concurrent initiation cannot overwrite
  //    the winner's identifiers.
  try {
    const claimed = await db.$transaction(async (tx) => {
      // Legal-move check mirrors the guard in the update below; the
      // conditional update remains the enforcement boundary.
      assertPaymentTransition("PENDING", "PROCESSING");
      const result = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING", providerTransactionId: null },
        data: {
          status: "PROCESSING",
          providerTransactionId: stk.checkoutRequestId,
          metadata: mergePayheroMetadata(payment.metadata, {
            reference: stk.reference,
            initiationStatus: stk.status,
          }),
        },
      });
      return result.count;
    });

    if (claimed !== 1) {
      const current = (await db.payment.findUnique({
        where: { id: payment.id },
        select: PAYMENT_SELECT,
      })) as unknown as PaymentRow | null;
      if (current?.providerTransactionId) {
        return { outcome: "already_initiated", payment: publicPaymentView(current) };
      }
      throw new PaymentServiceError(
        "The payment could not be started. Please try again.",
        "provider_unavailable"
      );
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The provider handed us a CheckoutRequestID another row already holds —
      // impossible in a correct PayHero ledger; refuse rather than entangle.
      throw new PaymentServiceError(
        "The payment provider returned a conflicting transaction reference.",
        "provider_invalid_response"
      );
    }
    throw error;
  }

  await logAuditEvent({
    action: "payment.initiated",
    actorId: actor.userId,
    actorEmail: actor.email,
    targetType: "payment",
    targetId: payment.id,
    metadata: {
      provider: "PAYHERO",
      orderId: payment.orderId,
      amountCents: payment.amountCents,
      customerReference: payment.customerReference,
      retryCount: payment.retryCount,
      // No phone number, no PayHero token, no channel internals — the audit
      // trail answers "who started collecting what for how much".
    },
  }).catch(() => undefined);

  return {
    outcome: "initiated",
    payment: publicPaymentView({
      ...payment,
      status: "PROCESSING",
      providerTransactionId: stk.checkoutRequestId,
    }),
  };
}

function publicPaymentView(payment: PaymentRow) {
  return {
    id: payment.id,
    customerReference: payment.customerReference,
    status: payment.status,
    amountCents: payment.amountCents,
    providerTransactionId: payment.providerTransactionId,
  };
}

// ─── 2. Settlement primitives (callback + status verification share these) ──

export type SuccessClaim =
  | "claimed"
  /** The payment was already SUCCESS — a replay, not a new effect. */
  | "already_success"
  /** The payment is FAILED/CANCELLED/REFUNDED — a contradictory late success. */
  | "already_terminal_other"
  /**
   * A SIBLING payment for the same order is already SUCCESS (Phase 9.3).
   * One effective successful payment per order, enforced under the
   * order-keyed advisory lock: this attempt is the loser of the Payment A vs
   * Payment B race and must produce no further financial effect.
   */
  | "superseded";

export type PaymentIdentifiers = {
  /** M-Pesa receipt number (`MpesaReceiptNumber` / provider_reference). */
  providerReference?: string | null;
  merchantRequestId?: string | null;
  /** Backfill for the crash-window where initiation never persisted it. */
  checkoutRequestId?: string | null;
};

/**
 * Claims a payment as SUCCESS inside an OPEN transaction, guarded by a
 * conditional update on its current status. The caller owns the transaction
 * (the callback pipeline also records its PaymentEvent in the same one).
 *
 * ─── Serialization (Phase 9.3) ─────────────────────────────────────────────
 * The claim runs under `pg_advisory_xact_lock(hashtext(orderId))` — the same
 * order-scoped key initiation uses — so ALL success settlements for an order
 * (callback, status verification, concurrency, retries) pass through a single
 * gate. Inside the gate the function re-reads the row (the caller fetched it
 * pre-transaction, potentially before a competing claim committed) and checks
 * for a SIBLING success: if another payment of this order is already SUCCESS,
 * this attempt is superseded and produces no further effect; one effective
 * successful payment per order, at the database level, never by trusting a
 * previously-read status.
 *
 * Money metadata is only written when the claim succeeds — a replay or a
 * contradictory late success can never overwrite the winning settlement's
 * receipt reference or payload.
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
    metadata: mergePayheroMetadata(payment.metadata, {
      merchantRequestId: identifiers.merchantRequestId ?? undefined,
    }),
  };
  if (identifiers.providerReference) {
    data = { ...data, providerReference: identifiers.providerReference };
  }
  if (!payment.providerTransactionId && identifiers.checkoutRequestId) {
    data = { ...data, providerTransactionId: identifiers.checkoutRequestId };
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
 * primitive. Safe to call repeatedly (retried callbacks, status checks) — an
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
      actor: { id: PAYHERO_SYSTEM_ACTOR_ID, source },
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
 * The canonical post-claim completion of a successful payment — the ONLY code
 * that turns a claimed SUCCESS into an order transition plus its audit trail.
 *
 * Every trusted channel (STK callback, transaction-status verification) that
 * just observed a legitimately-claimed success calls this after its claim
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
  options: { source: string; claimedNow: boolean }
): Promise<SettleSuccessOutcome> {
  const orderOutcome = await markOrderPaidForPayment(db, payment, options.source);

  const breadcrumbs: Promise<unknown>[] = [];
  let successAudited = false;

  if (options.claimedNow) {
    successAudited = true;
    breadcrumbs.push(
      logAuditEvent({
        action: "payment.success",
        actorId: PAYHERO_SYSTEM_ACTOR_ID,
        targetType: "payment",
        targetId: payment.id,
        metadata: {
          provider: "PAYHERO",
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
        actorId: PAYHERO_SYSTEM_ACTOR_ID,
        targetType: "payment",
        targetId: payment.id,
        metadata: {
          provider: "PAYHERO",
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

  await Promise.all(breadcrumbs);
  return { ...orderOutcome, successAudited };
}

// ─── 3. Transaction-status verification / recovery ──────────────────────────

export type VerifyPayheroStatusResult =
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
   * untouched for reconciliation (a possible double collection a later refund
   * phase handles).
   */
  | { outcome: "superseded" }
  /** The payment is locally FAILED/CANCELLED; a status check never resurrects it. */
  | { outcome: "already_terminal"; status: string };

/**
 * Verifies a PayHero payment against `GET /transaction-status` — the recovery
 * path for "the callback never arrived" (and the cross-check channel a later
 * reconciliation sweep will batch through).
 *
 * Two inviolable rules:
 *  1. A locally-SUCCESS payment is returned as-is WITHOUT calling PayHero — a
 *     stale provider answer must never downgrade settled money.
 *  2. Non-SUCCESS provider answers go through the same conditional claims the
 *     callback uses, so verification and callback processing cannot fork the
 *     ledger.
 */
export async function verifyPayheroPaymentStatus(
  db: PaymentStore,
  params: {
    paymentId: string;
    client?: PayheroClient;
    env?: PayheroConfigSource;
  }
): Promise<VerifyPayheroStatusResult> {
  const payment = (await db.payment.findUnique({
    where: { id: params.paymentId },
    select: PAYMENT_SELECT,
  })) as unknown as PaymentRow | null;

  if (!payment || payment.provider !== "PAYHERO") {
    throw new PaymentServiceError("Payment not found.", "not_found");
  }

  // Rule 1: settled money is settled — no provider answer gets to rewrite
  // it. But "settled payment" and "settled order" are two steps with a crash
  // window between them, so before answering, close that window: re-run the
  // idempotent order transition (a no-op when the order is already PAID, an
  // exact recovery when it isn't). No audits here: the original settlement
  // recorded its own; this path only heals the order row.
  if (payment.status === "SUCCESS") {
    await markOrderPaidForPayment(db, payment, "payhero:status-check");
    return { outcome: "already_success" };
  }
  if (payment.status !== "PENDING" && payment.status !== "PROCESSING") {
    // A terminal failure has nothing to verify into — refunds belong to a
    // later phase, and this path never resurrects a settled outcome.
    return { outcome: "already_terminal", status: payment.status };
  }

  // PayHero's endpoint takes the initiation `reference` (stored in metadata)
  // or an M-Pesa code (providerReference). The CheckoutRequestID is NOT a
  // documented lookup key for it, so it is never substituted in.
  const lookupReference =
    readPayheroMetadata(payment.metadata).reference ?? payment.providerReference;
  if (!lookupReference) {
    throw new PaymentServiceError(
      "This payment has no provider reference to verify against yet.",
      "provider_rejected"
    );
  }

  const client = requireClient(params.client, params.env ?? process.env);

  let status: Awaited<ReturnType<PayheroClient["getTransactionStatus"]>>;
  try {
    status = await client.getTransactionStatus(lookupReference);
  } catch (error) {
    if (error instanceof PayheroClientError) throw mapClientError(error);
    throw error;
  }

  if (!status.knownStatus) {
    // An unrecognized word from the provider is never coerced into a state.
    console.warn("[payments] Unknown PayHero transaction status", {
      rawStatus: status.rawStatus,
    });
    return { outcome: "unknown_status", rawStatus: status.rawStatus };
  }

  if (status.status === "QUEUED") {
    return { outcome: "still_pending" };
  }

  if (status.status === "FAILED") {
    const claim = await db.$transaction(async (tx) =>
      claimPaymentFailure(
        tx,
        payment,
        { to: "FAILED", code: null, reason: "PayHero reported the transaction FAILED." },
        undefined
      )
    );
    if (claim === "claimed") {
      await afterPaymentFailureRecorded(db, payment, "status-check", "FAILED");
    }
    return { outcome: "verified_failed", paymentApplied: claim === "claimed" };
  }

  // SUCCESS, confirmed over PayHero's authenticated channel. The endpoint
  // does not report an amount, so the authoritative amount stays OUR row's —
  // the initiation already fixed it to the order total, and the success claim
  // below only writes settlement metadata, never the amount.
  const claim = await db.$transaction(async (tx) =>
    claimPaymentSuccess(
      tx,
      payment,
      {
        providerReference: status.providerReference,
        checkoutRequestId: status.checkoutRequestId,
      },
      undefined
    )
  );

  if (claim === "superseded") {
    // The provider confirms THIS attempt collected too, but a sibling attempt
    // already settled the order — the textbook double collection. No second
    // effect: the attempt is left untouched and flagged for reconciliation.
    console.warn("[payments] PayHero reported SUCCESS for a superseded payment attempt", {
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
        source: "payhero:status-check",
      },
    }).catch(() => undefined);
    return { outcome: "superseded" };
  }

  if (claim === "already_terminal_other") {
    // Local terminal failure + provider success = a contradiction a human
    // must see; the first-recorded terminal outcome stays authoritative.
    console.error("[payments] PayHero status SUCCESS contradicts local terminal state", {
      paymentId: payment.id,
    });
    return { outcome: "verified_failed", paymentApplied: false };
  }

  const orderOutcome = await settleSuccessfulPayment(db, payment, {
    source: "payhero:status-check",
    claimedNow: claim === "claimed",
  });
  return {
    outcome: "verified_success",
    paymentApplied: claim === "claimed",
    orderChanged: orderOutcome.orderChanged,
    anomaly: orderOutcome.anomaly,
  };
}

/**
 * Best-effort post-commit fan-out for a recorded terminal non-collection:
 * audit + a buyer notification. Both are deliberately outside the
 * transaction, exactly as the transition service does it — the ledger write
 * is authoritative and must not be rollable-back by an email hiccup.
 *
 * `payment.cancelled` vs `payment.failed` is kept distinct on purpose: a
 * buyer who dismissed the STK prompt and one whose M-Pesa attempt actually
 * failed are different support situations, and neither touches the ORDER
 * (it stays PENDING and payable — a retry is a legitimate new attempt).
 */
export async function afterPaymentFailureRecorded(
  db: PaymentStore,
  payment: { id: string; orderId: string; amountCents: number },
  source: string,
  to: "FAILED" | "CANCELLED"
): Promise<void> {
  const order = (await db.order.findUnique({
    where: { id: payment.orderId },
    select: { orderNumber: true, buyerId: true },
  })) as { orderNumber: string; buyerId: string } | null;

  await Promise.all([
    logAuditEvent({
      action: to === "CANCELLED" ? "payment.cancelled" : "payment.failed",
      actorId: PAYHERO_SYSTEM_ACTOR_ID,
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: "PAYHERO",
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
              ? "The M-Pesa prompt was cancelled before payment. Your order is still waiting for payment — you can try again from your orders page."
              : "The M-Pesa payment did not go through. You can try paying again from your orders page.",
          linkUrl: `/buyer/orders`,
        }).catch(() => undefined)
      : Promise.resolve(),
  ]);
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

export type { PayheroConfigSource };
