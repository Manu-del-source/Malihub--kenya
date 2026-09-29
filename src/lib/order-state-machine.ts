import type { OrderStatus } from "@prisma/client";

/**
 * The order lifecycle — the single authority on which `Order.status` moves where.
 *
 * ─── Why this is a separate, pure module ─────────────────────────────────────
 * Two failure modes make a scattered `prisma.order.update({ data: { status } })`
 * dangerous, and this file exists to make both impossible:
 *
 *   1. **A transition that should be impossible becomes possible.** Writing a
 *      status directly bypasses every rule about which move is legal, so
 *      `CANCELLED → PAID` or `PAID → PENDING` become one careless line away.
 *   2. **The rules and the writes drift apart.** If "can this move?" lives in a
 *      service and "does this write?" lives in a route, they disagree the
 *      first time someone adds a second caller.
 *
 * So: this module answers *only* "is this move legal?", contains no database
 * access, and is the thing `order-transition-service.ts` consults before it
 * writes anything. Everything here is a pure function over two enum values.
 *
 * ─── The lifecycle ───────────────────────────────────────────────────────────
 *
 *     PENDING ──(payment confirmed, Phase 9.2)──▶ PAID
 *        │                                          │
 *        │                                          ▼
 *        │                                       SHIPPED
 *        │                                          │
 *        │                                          ▼
 *        │                                       DELIVERED
 *        │                                          │
 *        │                                          ▼
 *        │                                      COMPLETED   (terminal)
 *        │
 *        └──(buyer cancels an unpaid order)──▶ CANCELLED    (terminal)
 *
 * ─── `CONFIRMED` is a reserved legacy value ──────────────────────────────────
 * The enum carries a `CONFIRMED` value (schema.prisma) but **no code in this
 * repository ever writes it, branches on it, or gives it a meaning**. The only
 * things that mention it are an admin filter dropdown and a display label,
 * plus a stale comment on the admin orders page describing a
 * `PENDING → CONFIRMED → PAID` lifecycle that no implementation ever backed.
 *
 * It is also semantically redundant: `src/lib/order-status.ts` labels `PENDING`
 * as "Awaiting payment", and `isPaidOrderStatus` treats `CONFIRMED` as *not*
 * paid. So if `CONFIRMED` meant "payment received", it would duplicate `PAID`;
 * if it meant "buyer placed the order", it duplicates `PENDING`. It has no
 * coherent role, so:
 *
 *   - it is **kept** in the schema (removing an enum value is a destructive
 *     migration and is explicitly out of scope here);
 *   - it is **never a source** and **never a destination** of a transition;
 *   - reads keep working — it still has a label and still appears in the admin
 *     filter, so any row that somehow carries it still renders.
 *
 * If a future phase genuinely needs a "seller has accepted" step, it should be
 * given a *new*, clearly-named value with a real state machine entry — not
 * revived by quietly adding `PENDING → CONFIRMED` here.
 *
 * ─── `REFUNDED` is owned by a later phase ────────────────────────────────────
 * `REFUNDED` is terminal here on purpose. It is a *financial* event that a
 * `RefundService` (Phase 9.7) will set only after a provider confirms money
 * actually moved back. Phase 9.1 must not offer a path into it, or an
 * application-level flag could mark a buyer "refunded" while the money is still
 * with the payment provider.
 */

/**
 * Statuses that exist in the enum but that this application never transitions
 * into or out of. See the `CONFIRMED` note above.
 */
export const RESERVED_ORDER_STATUSES: readonly OrderStatus[] = ["CONFIRMED"];

/**
 * Statuses an order can never leave.
 *
 * `CANCELLED` and `COMPLETED` are the two normal endings. `REFUNDED` is here
 * too, so that when the refund phase lands it inherits an already-closed state
 * rather than having to widen the terminal set while money is involved.
 */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "CANCELLED",
  "COMPLETED",
  "REFUNDED",
];

/**
 * The complete, explicit set of legal moves. Anything absent is illegal — this
 * is an allowlist, never a denylist, so a status added to the Prisma enum
 * later is unreachable by default rather than wide open.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // Payment collection is Phase 9.2; `PAID` is claimed by the payment
  // confirmation path only, never by a client request.
  PENDING: ["PAID", "CANCELLED"],
  CONFIRMED: [],
  PAID: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/** Why a proposed move was refused. Drives both the message and the route's
 *  status code, so the two can't disagree. */
export type OrderTransitionRejection =
  | "reserved_status"
  | "terminal_status"
  | "not_allowed";

export class OrderTransitionError extends Error {
  readonly code: OrderTransitionRejection;
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus) {
    super(OrderTransitionError.describe(from, to));
    this.name = "OrderTransitionError";
    this.from = from;
    this.to = to;
    this.code = OrderTransitionError.classify(from, to);
  }

  static classify(from: OrderStatus, to: OrderStatus): OrderTransitionRejection {
    if (RESERVED_ORDER_STATUSES.includes(from) || RESERVED_ORDER_STATUSES.includes(to)) {
      return "reserved_status";
    }
    if (TERMINAL_ORDER_STATUSES.includes(from)) return "terminal_status";
    return "not_allowed";
  }

  /** Copy safe to show a user: describes the rule, never the data. */
  static describe(from: OrderStatus, to: OrderStatus): string {
    if (RESERVED_ORDER_STATUSES.includes(from) || RESERVED_ORDER_STATUSES.includes(to)) {
      return `Order status ${from} is a reserved value and cannot be reached from the order lifecycle.`;
    }
    if (TERMINAL_ORDER_STATUSES.includes(from)) {
      return `This order is already ${from.toLowerCase()} and can no longer be changed.`;
    }
    return `An order cannot move from ${from} to ${to}.`;
  }
}

/** Legal destinations from `status`. Empty for terminal and reserved states. */
export function allowedTransitionsFrom(status: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[status] ?? [];
}

/** True when this status is a permanent ending. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/** True when this status is part of the enum but outside the lifecycle. */
export function isReservedOrderStatus(status: OrderStatus): boolean {
  return RESERVED_ORDER_STATUSES.includes(status);
}

/**
 * The single question the rest of the app asks: is `from → to` legal?
 *
 * A move to the *same* status is deliberately not legal here. Whether a repeat
 * request should be an idempotent success or a conflict is a decision about
 * side effects, which only the caller can make — see
 * `order-transition-service.ts`, where cancelling an already-cancelled order is
 * a conflict but re-confirming a paid one is a no-op.
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitionsFrom(from).includes(to);
}

/** Throws `OrderTransitionError` unless `from → to` is legal. */
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) throw new OrderTransitionError(from, to);
}
