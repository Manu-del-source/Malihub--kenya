import "server-only";

import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import {
  assertOrderTransition,
  isTerminalOrderStatus,
  type OrderTransitionRejection,
} from "@/lib/order-state-machine";
import { logAuditEvent } from "@/services/audit-service";
import { notifyUser } from "@/services/notification-service";

/**
 * The one place `Order.status` changes.
 *
 * ─── Why status writes are gathered here ─────────────────────────────────────
 * Before this module, the only writer in the entire repository was order
 * creation (`checkoutCart` → `PENDING`); every other `status:` in the codebase
 * was a `count({ where: { status } })` read. That is a good state to be in, and
 * it is the reason this is additive rather than a refactor.
 *
 * Everything that moves an order now goes through the three exports below.
 * They differ only in *who* may call them and *what* they do alongside the
 * status change:
 *
 *   - `cancelOrder`      — the buyer cancelling their own unpaid order. Also
 *                          releases the inventory checkout reserved.
 *   - `markOrderPaid`    — the `PENDING → PAID` primitive Phase 9.2's payment
 *                          confirmation will call. Not reachable from any route.
 *   - `markOrderFulfilled` — seller/buyer fulfilment (shipped, delivered,
 *                          completed). No route or UI in this phase.
 *
 * ─── The concurrency mechanism (read this before adding a writer) ───────────
 * Every transition follows the same three beats, inside ONE transaction:
 *
 *   1. **Read** the row inside the transaction.
 *   2. **Validate** the move with the pure state machine.
 *   3. **Claim** it with a conditional `updateMany` whose `where` includes the
 *      status we just read — a compare-and-swap.
 *
 * Step 3 is what makes concurrent requests safe, and the `where: { status }`
 * clause is load-bearing in a way that is easy to break. A plain
 * `order.update({ where: { id }, data: { status } })` would be "read PENDING,
 * validate, write" — two buyers hitting cancel at once would both read PENDING,
 * both validate, and both write, and the second one would restore the same
 * inventory a second time. With the conditional update, the second writer's
 * `where` no longer matches (the first committed `CANCELLED`), `count` comes
 * back 0, and it aborts *before* touching inventory.
 *
 * This is the same claim-then-act shape `checkoutCart` already uses for the
 * cart (`src/services/order-service.ts`), for the same reason.
 *
 * ─── Ordering inside a transaction: claim before side effects ───────────────
 * Within the transaction the status claim happens BEFORE any inventory is
 * restored. If the claim fails we throw immediately and no inventory is
 * touched; if a later step throws, the whole transaction rolls back and the
 * status change goes with it. So "order cancelled but stock never returned" and
 * "stock returned but order still pending" are both unreachable.
 *
 * ─── Audit and notification run AFTER the commit ────────────────────────────
 * The database transaction is authoritative. `notifyUser` is not even wrapped
 * in a try/catch internally, and `logAuditEvent` swallows its own errors, so
 * both are called after `$transaction` resolves and both are guarded here. A
 * failed notification must never be able to undo a committed cancellation —
 * and equally, it must never be able to leave one half-applied.
 *
 * ─── Authorization is never a parameter of the caller's choosing ─────────────
 * `actorUserId` is resolved from the session by the route and passed in; the
 * service then re-checks ownership against the database row it read. Nothing
 * here accepts a role, a seller id, or a target status from a request body.
 */

export type OrderTransitionStore = Pick<
  PrismaClient,
  "order" | "orderItem" | "product" | "seller" | "$transaction"
>;

/** Why a transition was refused, in terms a route can map to a status code. */
export type OrderTransitionErrorCode =
  | "not_found"
  | "already_cancelled"
  | "invalid_transition"
  | "amount_mismatch";

export class OrderTransitionError extends Error {
  readonly code: OrderTransitionErrorCode;
  /** Present on refusals that know the order's actual state. */
  readonly currentStatus?: OrderStatus;

  constructor(message: string, code: OrderTransitionErrorCode, currentStatus?: OrderStatus) {
    super(message);
    this.name = "OrderTransitionError";
    this.code = code;
    this.currentStatus = currentStatus;
  }
}

export type OrderTransitionResult = {
  order: { id: string; orderNumber: string; status: OrderStatus; totalCents: number };
  previousStatus: OrderStatus;
  /**
   * `false` when the order was already in the target state and nothing was
   * written. Repeating a request is always safe; whether that reads as success
   * or a conflict is decided per-transition (see `cancelOrder`).
   */
  changed: boolean;
  /** Total units returned to listings. Always 0 for non-cancellations. */
  restoredUnits: number;
};

const TRANSITION_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  totalCents: true,
} satisfies Prisma.OrderSelect;

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  buyerId: string;
  sellerId: string;
};

// ─── Cancellation ────────────────────────────────────────────────────────────

export type CancelOrderParams = {
  /** The authenticated buyer's application user id, resolved from the session. */
  actorUserId: string;
  orderId: string;
  /** Optional free text for the audit trail. Never shown to another party. */
  reason?: string | null;
};

/**
 * Cancels a buyer's own unpaid order and returns its reserved inventory.
 *
 * Only `PENDING → CANCELLED` exists, and a `PENDING` order by definition has
 * collected no money (payment collection is Phase 9.2), so there is no
 * financial side effect to unwind here. Refund-adjacent concerns — reversing a
 * settlement, clawing back a payout — belong to later phases and are explicitly
 * out of this function's remit.
 *
 * **A repeat request is a controlled conflict, not a silent success.** The
 * second caller gets `already_cancelled` (409) and, critically, no second
 * inventory release. Returning 200 would be defensible too, but a cancellation
 * is a destructive act with a visible consequence, and "already cancelled" is
 * the more honest answer to a double-submitted button.
 *
 * Inventory comes from `OrderItem.quantity` — the database's own record of what
 * was reserved at checkout. The request carries no quantities, so a caller
 * cannot ask for 2 units back from a 5-unit order.
 */
export async function cancelOrder(
  db: OrderTransitionStore,
  params: CancelOrderParams
): Promise<OrderTransitionResult> {
  const { actorUserId, orderId } = params;
  if (!actorUserId || !orderId) {
    throw new OrderTransitionError("An order id is required.", "not_found");
  }

  const outcome = await db.$transaction(async (tx) => {
    // 1. Read, scoped to the caller. An order that exists but belongs to
    //    someone else is indistinguishable from one that does not exist, so
    //    this id can never be used to probe for other buyers' orders.
    const order = (await tx.order.findFirst({
      where: { id: orderId, buyerId: actorUserId },
      select: { ...TRANSITION_SELECT, buyerId: true, sellerId: true },
    })) as OrderRow | null;

    if (!order) {
      throw new OrderTransitionError("Order not found.", "not_found");
    }

    const from = order.status as OrderStatus;

    // 2. An order you already cancelled is a conflict, answered before the
    //    claim so the message is specific rather than a generic race failure.
    if (from === "CANCELLED") {
      throw new OrderTransitionError(
        "This order has already been cancelled.",
        "already_cancelled",
        from
      );
    }

    // 3. Pure validation. A paid/shipped/completed order cannot be cancelled;
    //    CANCELLED → CANCELLED and anything else is refused here too.
    try {
      assertOrderTransition(from, "CANCELLED");
    } catch (error) {
      throw new OrderTransitionError(
        error instanceof Error ? error.message : "This order cannot be cancelled.",
        "invalid_transition",
        from
      );
    }

    // 4. THE CLAIM. Conditional on the status we just read, so a concurrent
    //    cancel or payment wins here and this request aborts having touched
    //    nothing but a read.
    const claimed = await tx.order.updateMany({
      where: { id: orderId, buyerId: actorUserId, status: from },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== 1) {
      // Lost the race: the row is no longer in the state we validated. The
      // transaction rolls back, so no inventory was restored.
      const current = (await tx.order.findFirst({
        where: { id: orderId, buyerId: actorUserId },
        select: { status: true },
      })) as { status: string } | null;

      if (current?.status === "CANCELLED") {
        throw new OrderTransitionError(
          "This order has already been cancelled.",
          "already_cancelled",
          "CANCELLED"
        );
      }
      throw new OrderTransitionError(
        "This order changed while it was being cancelled. Please reload and try again.",
        "invalid_transition",
        (current?.status as OrderStatus | undefined) ?? from
      );
    }

    // 5. Release exactly what was reserved, from the order's own line items.
    //    `quantity: { increment }` only touches the quantity column, so a
    //    listing that was moderated to SUSPENDED/REMOVED while the order was
    //    open still gets its stock back — losing those units would be a
    //    moderation decision quietly destroying inventory. Products cannot be
    //    hard-deleted while an order references them (OrderItem.product is
    //    onDelete: Restrict), so a missing product here means a corrupted
    //    order, and the throw rolls the cancellation back.
    const items = (await tx.orderItem.findMany({
      where: { orderId },
      select: { productId: true, quantity: true },
    })) as Array<{ productId: string; quantity: number }>;

    let restoredUnits = 0;
    for (const item of items) {
      const restored = await tx.product.updateMany({
        where: { id: item.productId },
        data: { quantity: { increment: item.quantity } },
      });
      if (restored.count !== 1) {
        throw new OrderTransitionError(
          "A listing on this order no longer exists, so the order was not cancelled.",
          "invalid_transition",
          from
        );
      }
      restoredUnits += item.quantity;
    }

    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: "CANCELLED" as OrderStatus,
        totalCents: order.totalCents,
      },
      previousStatus: from,
      changed: true,
      restoredUnits,
      // `Notification.userId` references `users.id`, while `Order.sellerId`
      // references the `sellers` row. They are different ids, so the seller's
      // *user* has to be resolved or the notification would be addressed to a
      // user id that does not exist.
      sellerUserId: await resolveSellerUserId(tx, order.sellerId),
      buyerId: order.buyerId,
    };
  });

  // ─── After the commit: best-effort side effects ────────────────────────────
  await Promise.all([
    logAuditEvent({
      action: "order.cancelled",
      actorId: actorUserId,
      targetType: "order",
      targetId: outcome.order.id,
      // The transition and the units released. No addresses, no contact
      // details, no payment data — the audit trail answers "what changed and
      // who changed it", which is all it should ever answer.
      metadata: {
        from: outcome.previousStatus,
        to: "CANCELLED",
        orderNumber: outcome.order.orderNumber,
        restoredUnits: outcome.restoredUnits,
        ...(params.reason ? { reason: params.reason.slice(0, 200) } : {}),
      },
    }).catch(() => undefined),
    notifyOrderTransition({
      userIds: [actorUserId, outcome.sellerUserId],
      heading: `Order ${outcome.order.orderNumber} cancelled`,
      body:
        outcome.restoredUnits > 0
          ? `This order was cancelled and ${outcome.restoredUnits} unit${
              outcome.restoredUnits === 1 ? "" : "s"
            } went back into stock.`
          : "This order was cancelled.",
    }),
  ]);

  return {
    order: outcome.order,
    previousStatus: outcome.previousStatus,
    changed: outcome.changed,
    restoredUnits: outcome.restoredUnits,
  };
}

// ─── PENDING → PAID (Phase 9.2 seam) ─────────────────────────────────────────

/**
 * What a verified payment confirmation carries.
 *
 * Deliberately has no `status` field: a payment confirmation says "this
 * amount was collected for this order", and the service decides what that means
 * for the order's lifecycle. Accepting a status here would let any future
 * caller — a webhook, a backfill script, a well-meaning retry — move an order
 * to a state the state machine does not permit.
 */
export type PaymentConfirmation = {
  orderId: string;
  /**
   * The amount the provider confirmed, in integer cents. Optional only so the
   * primitive can be exercised before a provider exists; when present it is
   * checked against the authoritative `Order.totalCents` and a mismatch
   * refuses the transition. Phase 9.2 should always pass it.
   */
  confirmedTotalCents?: number;
  /** The order number the provider echoed back, when it supplied one. */
  orderNumber?: string | null;
  /**
   * Who drove this. Always an internal, trusted caller — a verified provider
   * callback, or an explicitly attributed manual action. There is no route in
   * this phase, and Phase 9.2 must not add a buyer-facing one.
   */
  actor: { id: string; email?: string | null; source: string };
};

/**
 * The `PENDING → PAID` primitive.
 *
 * **No payment is collected here and no `Payment` row is created.** This moves
 * the order and nothing else. Payment record creation, provider correlation and
 * settlement are Phase 9.2+ concerns, and faking a `Payment` row to make this
 * look complete would put a lie in the one table the whole financial system
 * will be reconciled against.
 *
 * Idempotent: re-confirming an order that is already `PAID` returns
 * `changed: false` and writes nothing. That is the right behaviour for a
 * retried webhook, which is the caller this is being built for.
 */
export async function markOrderPaid(
  db: OrderTransitionStore,
  confirmation: PaymentConfirmation
): Promise<OrderTransitionResult> {
  const { orderId, confirmedTotalCents, orderNumber, actor } = confirmation;
  if (!orderId) {
    throw new OrderTransitionError("An order id is required.", "not_found");
  }

  const outcome = await db.$transaction(async (tx) => {
    const order = (await tx.order.findFirst({
      where: { id: orderId },
      select: { ...TRANSITION_SELECT, buyerId: true, sellerId: true },
    })) as OrderRow | null;

    if (!order) throw new OrderTransitionError("Order not found.", "not_found");

    const from = order.status as OrderStatus;

    // Idempotent replay of a retried callback.
    if (from === "PAID") {
      return {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: "PAID" as OrderStatus,
          totalCents: order.totalCents,
        },
        previousStatus: from,
        changed: false,
        restoredUnits: 0,
        sellerUserId: await resolveSellerUserId(tx, order.sellerId),
        buyerId: order.buyerId,
      };
    }

    try {
      assertOrderTransition(from, "PAID");
    } catch (error) {
      throw new OrderTransitionError(
        error instanceof Error ? error.message : "This order cannot be marked paid.",
        "invalid_transition",
        from
      );
    }

    // The order number is our own reference; if the provider echoed one it
    // must be the right one, or this is a mismatched callback.
    if (orderNumber && orderNumber !== order.orderNumber) {
      throw new OrderTransitionError(
        "The payment reference does not match this order.",
        "amount_mismatch",
        from
      );
    }

    // The money check. The amount is compared against `Order.totalCents` read
    // from the database inside this transaction — never against anything the
    // caller sent about the total, and never against a value cached from an
    // earlier read.
    if (
      confirmedTotalCents !== undefined &&
      confirmedTotalCents !== order.totalCents
    ) {
      throw new OrderTransitionError(
        "The confirmed payment amount does not match this order's total.",
        "amount_mismatch",
        from
      );
    }

    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: from },
      data: { status: "PAID" },
    });
    if (claimed.count !== 1) {
      throw new OrderTransitionError(
        "This order changed while its payment was being confirmed.",
        "invalid_transition",
        from
      );
    }

    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: "PAID" as OrderStatus,
        totalCents: order.totalCents,
      },
      previousStatus: from,
      changed: true,
      restoredUnits: 0,
      sellerUserId: await resolveSellerUserId(tx, order.sellerId),
      buyerId: order.buyerId,
    };
  });

  if (outcome.changed) {
    await Promise.all([
      logAuditEvent({
        action: "order.paid",
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        targetType: "order",
        targetId: outcome.order.id,
        metadata: {
          from: outcome.previousStatus,
          to: "PAID",
          orderNumber: outcome.order.orderNumber,
          // The confirmed amount, in cents, is financial record-keeping rather
          // than a credential — but no provider ids or payer details are
          // written here. Those belong on the `Payment` row in Phase 9.2.
          source: actor.source,
        },
      }).catch(() => undefined),
      notifyOrderTransition({
        userIds: [outcome.buyerId, outcome.sellerUserId],
        heading: `Order ${outcome.order.orderNumber} paid`,
        body: "Payment was confirmed for this order.",
      }),
    ]);
  }

  return {
    order: outcome.order,
    previousStatus: outcome.previousStatus,
    changed: outcome.changed,
    restoredUnits: outcome.restoredUnits,
  };
}

// ─── Fulfillment (service support only — no route, no UI in Phase 9.1) ───────

/**
 * Who is allowed to drive each fulfilment step.
 *
 * - Shipping and delivery are the **seller's** to record: they are the party
 *   holding the goods, and no other participant has better information.
 * - Completion is the **buyer's** to confirm. Keeping the party that is owed
 *   the money out of the "close this out" decision is deliberate; a system
 *   auto-complete job is a later phase and would need its own rule here.
 *
 * Admin is intentionally absent. `ADMIN` and `SUPER_ADMIN` are functionally
 * identical in this codebase today, and granting either a blanket ability to
 * move orders would hand every staff account a way to alter a financial
 * record. Adding that is a role/permission decision, not a Phase 9.1 one.
 */
export type FulfillmentStep = "SHIPPED" | "DELIVERED" | "COMPLETED";

export const FULFILLMENT_AUTHORITY: Readonly<Record<FulfillmentStep, "seller" | "buyer">> = {
  SHIPPED: "seller",
  DELIVERED: "seller",
  COMPLETED: "buyer",
};

export type FulfillmentParams = {
  orderId: string;
  /** Session-resolved application user id of the acting party. */
  actorUserId: string;
  /** Present only when the actor owns a `sellers` row. Resolved internally. */
  actorSellerId?: string | null;
};

/**
 * Applies one fulfilment transition. Exposed for the service layer and its
 * tests; deliberately not wired to a route or a button in this phase, because
 * the seller order screens have no fulfilment UI to attach it to yet.
 */
export async function markOrderFulfilled(
  db: OrderTransitionStore,
  step: FulfillmentStep,
  params: FulfillmentParams
): Promise<OrderTransitionResult> {
  const authority = FULFILLMENT_AUTHORITY[step];
  if (authority === "seller" && !params.actorSellerId) {
    throw new OrderTransitionError(
      "Only the seller who owns this order can record fulfilment.",
      "invalid_transition"
    );
  }

  const outcome = await db.$transaction(async (tx) => {
    const order = (await tx.order.findFirst({
      where: { id: params.orderId },
      select: { ...TRANSITION_SELECT, buyerId: true, sellerId: true },
    })) as OrderRow | null;

    if (!order) throw new OrderTransitionError("Order not found.", "not_found");

    // Ownership, checked against the row rather than against a request value.
    const owns =
      authority === "seller"
        ? order.sellerId === params.actorSellerId
        : order.buyerId === params.actorUserId;
    if (!owns) {
      throw new OrderTransitionError("Order not found.", "not_found");
    }

    const from = order.status as OrderStatus;
    if (from === step) {
      // Idempotent repeat.
      return {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: from,
          totalCents: order.totalCents,
        },
        previousStatus: from,
        changed: false,
        restoredUnits: 0,
      };
    }

    try {
      assertOrderTransition(from, step);
    } catch (error) {
      throw new OrderTransitionError(
        error instanceof Error ? error.message : "This order cannot move to that status.",
        "invalid_transition",
        from
      );
    }

    const claimed = await tx.order.updateMany({
      where: { id: params.orderId, status: from },
      data: { status: step },
    });
    if (claimed.count !== 1) {
      throw new OrderTransitionError(
        "This order changed while it was being updated.",
        "invalid_transition",
        from
      );
    }

    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: step as OrderStatus,
        totalCents: order.totalCents,
      },
      previousStatus: from,
      changed: true,
      restoredUnits: 0,
      buyerId: order.buyerId,
      sellerUserId: await resolveSellerUserId(tx, order.sellerId),
    };
  });

  if (outcome.changed) {
    await Promise.all([
      logAuditEvent({
        action: `order.${step.toLowerCase()}` as "order.shipped" | "order.delivered" | "order.completed",
        actorId: params.actorUserId,
        targetType: "order",
        targetId: outcome.order.id,
        metadata: {
          from: outcome.previousStatus,
          to: step,
          orderNumber: outcome.order.orderNumber,
        },
      }).catch(() => undefined),
      notifyOrderTransition({
        userIds: [outcome.buyerId, outcome.sellerUserId],
        heading: `Order ${outcome.order.orderNumber} is now ${step.toLowerCase()}`,
        body: `This order moved to ${step.toLowerCase()}.`,
      }),
    ]);
  }

  return {
    order: outcome.order,
    previousStatus: outcome.previousStatus,
    changed: outcome.changed,
    restoredUnits: outcome.restoredUnits,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves a `sellers.id` to the owning `users.id`.
 *
 * `Order.sellerId` and `Notification.userId` reference different tables, so any
 * notification aimed at "the seller" has to go through this. Returns null
 * rather than throwing: a missing seller row means there is simply nobody to
 * notify, and that must not fail an already-committed transition.
 */
async function resolveSellerUserId(
  tx: { seller: { findUnique: (args: unknown) => Promise<{ userId: string } | null> } },
  sellerId: string
): Promise<string | null> {
  const seller = await tx.seller.findUnique({
    where: { id: sellerId },
    select: { userId: true },
  });
  return seller?.userId ?? null;
}

/**
 * Best-effort notification fan-out. Wrapped because `notifyUser` does not catch
 * its own errors, and a notification failure must not surface as a failed
 * cancellation — the transaction is already committed and correct.
 */
async function notifyOrderTransition(params: {
  userIds: Array<string | null | undefined>;
  heading: string;
  body: string;
}): Promise<void> {
  await Promise.all(
    [...new Set(params.userIds.filter((id): id is string => Boolean(id)))].map((userId) =>
      notifyUser({
        userId,
        type: "ORDER_UPDATE",
        title: params.heading,
        body: params.body,
        linkUrl: `/buyer/orders`,
      }).catch(() => undefined)
    )
  );
}

export { isTerminalOrderStatus };
export type { OrderTransitionRejection };
