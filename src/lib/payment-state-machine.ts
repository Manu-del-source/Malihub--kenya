import type { PaymentStatus } from "@prisma/client";

/**
 * The payment-attempt lifecycle — the single authority on which
 * `Payment.status` moves where.
 *
 * ─── Why this exists alongside conditional claims ───────────────────────────
 * Every real Payment write in the codebase already goes through a conditional
 * claim (`updateMany` guarded on the current status) inside
 * `payment-service.ts`, so an illegal move cannot be *written* even without
 * this module. What the claims could not do is *say* what the rules are —
 * the legality of a transition was implicit in scattered `where` clauses.
 * This module makes the rules explicit, pure, and testable, mirroring
 * `order-state-machine.ts`: it answers only "is this move legal?", contains
 * no database access, and the services consult it before (and the database
 * re-checks it via the conditional update, during) every write.
 *
 * ─── The lifecycle ──────────────────────────────────────────────────────────
 *
 *     PENDING ──(STK push accepted by provider)──▶ PROCESSING
 *        │                                            │
 *        │              ┌─(verified collection)───────┤
 *        ▼              ▼                             ▼
 *     SUCCESS        FAILED                        CANCELLED
 *    (terminal)    (terminal)                      (terminal)
 *
 * - `PENDING`     — the row was reserved; the provider may not have been
 *                   called yet (crash window). Resumable.
 * - `PROCESSING`  — the provider accepted the prompt (PayHero `QUEUED`).
 *                   It is NOT money: never settles anything.
 * - `SUCCESS`     — the provider confirmed collection (callback or
 *                   transaction-status verification). Terminal.
 * - `FAILED`      — the provider reported a terminal non-collection.
 *                   Terminal. A retry creates a NEW attempt; this row is
 *                   history and never moves again.
 * - `CANCELLED`   — the buyer dismissed/cancelled the STK prompt (M-Pesa
 *                   result 1032). Terminal. Distinct from order
 *                   cancellation: the ORDER stays PENDING and payable.
 * - `REFUNDED`    — owned by the refund phase (Phase 9.4+). Terminal here:
 *                   nothing in collection may move a payment into or out of
 *                   it; a refund is a financial event that must never be an
 *                   application-level status flag.
 *
 * ─── Terminal-first-wins, deliberately ──────────────────────────────────────
 * `FAILED → SUCCESS` and `CANCELLED → SUCCESS` are NOT legal, even though a
 * provider can in principle report a late success for an attempt we already
 * recorded as failed. The FIRST terminal outcome recorded stays
 * authoritative: a contradicting late success is a genuine anomaly (possibly
 * a real double charge) and is surfaced as an audited anomaly for
 * reconciliation — never by rewriting history on the row. This is the
 * property that keeps one payment attempt from being both "failed, retry
 * allowed" and "settled".
 *
 * ─── Settlement is per-ORDER, this is per-PAYMENT ───────────────────────────
 * A legal `PROCESSING → SUCCESS` here is still not enough to settle: at most
 * ONE payment per order may ever become SUCCESS. That invariant is enforced
 * where it can be atomic — inside the claim transaction in
 * `payment-service.ts` (advisory-lock-serialized sibling check) — not here,
 * because a pure function over two statuses cannot see an order's siblings.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ["PROCESSING", "SUCCESS", "FAILED", "CANCELLED"],
  PROCESSING: ["SUCCESS", "FAILED", "CANCELLED"],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Statuses a payment attempt can never leave. Money-state is append-only:
 * once the provider's answer (or its absence) is on record, the attempt is
 * history. `REFUNDED` is terminal for the same reason — undoing a refund is
 * another financial event, not a status edit.
 */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
];

/** Statuses the provider can still move — the claim guard's mirror image. */
export const CLAIMABLE_PAYMENT_STATUSES: readonly PaymentStatus[] = ["PENDING", "PROCESSING"];

export class PaymentTransitionError extends Error {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;

  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(
      `A payment cannot move from ${from} to ${to}. ` +
        (TERMINAL_PAYMENT_STATUSES.includes(from)
          ? `${from} is terminal: the first recorded terminal outcome stays authoritative.`
          : `Allowed moves from ${from}: ${PAYMENT_TRANSITIONS[from].join(", ") || "none"}.`)
    );
    this.name = "PaymentTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Throws unless `from → to` is legal. Used as defense-in-depth ahead of the
 * conditional claims; the claims remain the actual enforcement boundary
 * (they re-check the status at write time, where a pure check cannot race).
 */
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canPaymentTransition(from, to)) {
    throw new PaymentTransitionError(from, to);
  }
}
