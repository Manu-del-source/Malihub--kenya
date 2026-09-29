import "server-only";

import { customAlphabet } from "nanoid";
import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";

/**
 * Orders — the buyer → cart → order → order-items → seller foundation.
 *
 * ─── What this phase does and deliberately does NOT do ──────────────────────
 * `checkoutCart()` turns a buyer's cart into one `Order` per seller (the
 * schema's documented shape — `Order.sellerId` is denormalized and NOT
 * nullable, so a multi-seller cart must split, not relax the constraint).
 * Orders are created `PENDING` and nothing here moves money: payment
 * collection is the future `Payment`/`PaymentEvent` boundary the schema and
 * `backend/` already model. No test, fixture, or UI in this phase may present
 * a `PENDING` order as paid.
 *
 * ─── Money is never client-supplied ─────────────────────────────────────────
 * Unit prices are read from the `products` row *inside* the checkout
 * transaction, inventory is decremented through a guarded `updateMany` (a
 * listing that went inactive or sold out mid-checkout fails the guard, rolls
 * the whole transaction back, and surfaces a user-safe error), and totals are
 * recomputed server-side. A request body contributes exactly one thing: the
 * caller's identity.
 *
 * ─── Ownership ──────────────────────────────────────────────────────────────
 * Every read is scoped by the *authenticated application user id* resolved by
 * the caller from the session. Buyer lookups filter `buyerId = userId`;
 * seller lookups re-resolve the caller's own `sellers` row first, then filter
 * `sellerId = <that row>` — an order id alone never grants access, so a
 * buyer poking at another buyer's order (or a seller at another seller's)
 * gets `null`, which the routes translate to 404.
 *
 * ─── Store injection ────────────────────────────────────────────────────────
 * Same DI shape as `account-provisioning.ts`: callers pass a Prisma handle so
 * the authorization rules are unit-testable against an in-memory fake.
 */

export type OrderErrorCode =
  | "empty_cart"
  | "unavailable"
  | "not_found"
  | "no_seller_profile";

/** A user-fixable checkout/order problem, with copy safe to show in the UI. */
export class OrderError extends Error {
  readonly code: OrderErrorCode;

  constructor(message: string, code: OrderErrorCode) {
    super(message);
    this.name = "OrderError";
    this.code = code;
  }
}

export type OrderStore = Pick<
  PrismaClient,
  "cartItem" | "product" | "order" | "orderItem" | "seller" | "profile"
>;

export type TransactionalOrderStore = Pick<PrismaClient, "$transaction">;

/**
 * Human-facing order number, matching the `MH-…` convention the payment
 * layer already expects (`Payment.customer_reference` echoes it back from the
 * processor — see backend/app/models/payment.py). Ambiguous characters (0/O,
 * 1/I) are excluded so a number quoted over the phone can't be mistyped into
 * another order. Collisions are retried against the unique index.
 */
const orderNumber = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

function nextOrderNumber(): string {
  return `MH-${orderNumber()}`;
}

/** The relation shape both the buyer and seller order screens consume. */
const ORDER_INCLUDE = {
  items: {
    include: {
      product: {
        select: {
          title: true,
          slug: true,
          condition: true,
          images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } },
        },
      },
    },
  },
  seller: { select: { businessName: true, slug: true, verificationStatus: true } },
  // The seller screens need to greet the buyer by name; the buyer's own
  // screens simply never read this branch.
  buyer: { select: { profile: { select: { fullName: true } } } },
} satisfies Prisma.OrderInclude;

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

type CheckoutItem = {
  productId: string;
  quantity: number;
};

export type CheckoutResult = {
  orders: Array<{
    id: string;
    orderNumber: string;
    sellerId: string;
    status: OrderStatus;
    subtotalCents: number;
    totalCents: number;
  }>;
};

/**
 * Converts the caller's cart into PENDING orders — one per seller — then
 * clears the cart, all inside a single transaction.
 *
 * Per-item guards run *inside* the transaction:
 *  0. the cart rows are claimed first (conditional UPDATE + count assert) so
 *     a concurrent checkout of the same cart can only ever win once;
 *  1. `updateMany({ id, status: 'ACTIVE', quantity >= n })` — the row count is
 *     the assertion; a zero count means the listing changed under us and
 *     rolls everything back;
 *  2. the unit price is re-read after the guard, so the order records the
 *     price the seller had at commit time, not the one seen before the
 *     transaction opened.
 */
export async function checkoutCart(
  db: OrderStore & TransactionalOrderStore,
  userId: string
): Promise<CheckoutResult> {
  const cartRows = await db.cartItem.findMany({
    where: { userId },
    select: { productId: true, quantity: true },
  });

  if (cartRows.length === 0) {
    throw new OrderError("Your cart is empty.", "empty_cart");
  }

  for (const row of cartRows) {
    if (!Number.isInteger(row.quantity) || row.quantity < 1) {
      throw new OrderError("Your cart contains an invalid quantity.", "unavailable");
    }
  }

  const productIds = cartRows.map((row) => row.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sellerId: true, status: true, quantity: true, title: true },
  });
  const byId = new Map<string, (typeof products)[number]>(
    products.map((p) => [p.id, p])
  );

  for (const row of cartRows) {
    const product = byId.get(row.productId);
    if (!product) {
      throw new OrderError("A listing in your cart no longer exists.", "unavailable");
    }
    if (product.status !== "ACTIVE") {
      throw new OrderError(`"${product.title}" is no longer available.`, "unavailable");
    }
    if (row.quantity > product.quantity) {
      throw new OrderError(
        `Only ${product.quantity} left in stock for "${product.title}".`,
        "unavailable"
      );
    }
  }

  const runCheckout = () =>
    db.$transaction(async (tx) => {
      // ── Claim the cart ────────────────────────────────────────────────────
      // The buyer's cart rows are a single-use token. This conditional
      // UPDATE both takes a row lock on every checked-out line and asserts
      // the lines still exist, BEFORE any stock moves. A second checkout of
      // the same cart — double-click, second tab, replayed POST — blocks on
      // these locks, then fails the count check once the winner has deleted
      // the rows, and rolls back with nothing created. Without this, two
      // overlapping checkouts whose stock guards both pass (stock > needed)
      // would each commit a full set of orders and decrement stock twice.
      const claimed = await tx.cartItem.updateMany({
        where: { userId, productId: { in: productIds } },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== cartRows.length) {
        throw new OrderError(
          "Your cart changed while we were checking out. Please review it and try again.",
          "unavailable"
        );
      }

      // Quantities re-read under the claim: charge what the cart holds at
      // commit time, not what the advisory pre-transaction read saw. Sorted
      // by productId so every checkout touches product rows in the same
      // order — opposite lock sequences between two buyers sharing listings
      // can otherwise deadlock one of them (Postgres would abort one tx; the
      // rollback would be safe but the buyer would see an opaque failure).
      const freshRows = await tx.cartItem.findMany({
        where: { userId, productId: { in: productIds } },
        orderBy: { productId: "asc" },
        select: { productId: true, quantity: true },
      });

      for (const row of freshRows) {
        if (!Number.isInteger(row.quantity) || row.quantity < 1) {
          throw new OrderError("Your cart contains an invalid quantity.", "unavailable");
        }
      }

      // One order per seller — see the module comment for why this splits
      // instead of relaxing Order.sellerId.
      const bySeller = new Map<string, CheckoutItem[]>();
      for (const row of freshRows) {
        const sellerId = byId.get(row.productId)!.sellerId;
        const group = bySeller.get(sellerId) ?? [];
        group.push({ productId: row.productId, quantity: row.quantity });
        bySeller.set(sellerId, group);
      }

      const created: CheckoutResult["orders"] = [];

      for (const [sellerId, items] of bySeller) {
        let subtotalCents = 0;
        const itemData: Array<{
          productId: string;
          quantity: number;
          unitPriceCents: number;
          totalCents: number;
        }> = [];

        for (const item of items) {
          const guarded = await tx.product.updateMany({
            where: { id: item.productId, status: "ACTIVE", quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity } },
          });
          if (guarded.count !== 1) {
            const current = await tx.product.findUnique({
              where: { id: item.productId },
              select: { title: true },
            });
            throw new OrderError(
              current
                ? `"${current.title}" sold out or was deactivated before checkout could finish.`
                : "A listing in your cart is no longer available.",
              "unavailable"
            );
          }

          const fresh = await tx.product.findUnique({
            where: { id: item.productId },
            select: { priceCents: true },
          });
          if (!fresh) throw new OrderError("A listing in your cart no longer exists.", "unavailable");

          const lineTotal = fresh.priceCents * item.quantity;
          subtotalCents += lineTotal;
          itemData.push({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: fresh.priceCents,
            totalCents: lineTotal,
          });
        }

        const order = await tx.order.create({
          data: {
            orderNumber: nextOrderNumber(),
            buyerId: userId,
            sellerId,
            status: "PENDING",
            subtotalCents,
            // No platform fees are added at this phase — commission and
            // payment fees belong to the future settlement step, which
            // adjusts the row that already exists rather than the total a
            // buyer was quoted.
            totalCents: subtotalCents,
            items: { create: itemData },
          },
          select: {
            id: true,
            orderNumber: true,
            sellerId: true,
            status: true,
            subtotalCents: true,
            totalCents: true,
          },
        });
        created.push(order);
      }

      await tx.cartItem.deleteMany({
        where: { userId, productId: { in: productIds } },
      });

      return { orders: created };
    });

  // Order-number collisions are the only P2002 that can land here, and the
  // retry wraps the WHOLE transaction rather than looping inside it: on
  // Postgres a constraint violation aborts the transaction, so a retry from
  // within it can never succeed. The failed attempt has fully rolled back —
  // cart rows restored, stock untouched — so a fresh transaction re-claims
  // everything cleanly. Anything else is a real failure to rethrow.
  for (let attempt = 0; ; attempt++) {
    try {
      return await runCheckout();
    } catch (error) {
      if (attempt >= 2 || !isUniqueViolation(error)) throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** The caller's own orders, newest first. Scoped by `buyerId` — always. */
export async function listBuyerOrders(db: OrderStore, userId: string): Promise<OrderWithItems[]> {
  return db.order.findMany({
    where: { buyerId: userId },
    orderBy: { createdAt: "desc" },
    include: ORDER_INCLUDE,
  });
}

/**
 * One order, but only if it belongs to this buyer. Returning `null` for both
 * "does not exist" and "belongs to someone else" is deliberate: the routes
 * answer 404 either way, so an order id can't be probed for existence.
 */
export async function getBuyerOrder(
  db: OrderStore,
  userId: string,
  orderId: string
): Promise<OrderWithItems | null> {
  return db.order.findFirst({
    where: { id: orderId, buyerId: userId },
    include: ORDER_INCLUDE,
  });
}

/**
 * Resolves the caller's own `sellers` row — the scope every seller-side order
 * query is anchored to. `null` means "this account has no seller profile",
 * which admin-support accounts hitting seller screens without a row produce.
 */
export async function getSellerRowForUser(db: OrderStore, userId: string) {
  return db.seller.findUnique({
    where: { userId },
    select: { id: true, businessName: true, verificationStatus: true },
  });
}

/**
 * Orders containing this seller's listings, newest first. The seller scope is
 * re-derived from `userId` inside the service — a caller-supplied `sellerId`
 * is never accepted.
 */
export async function listSellerOrders(
  db: OrderStore,
  userId: string
): Promise<OrderWithItems[] | null> {
  const seller = await getSellerRowForUser(db, userId);
  if (!seller) return null;

  return db.order.findMany({
    where: { sellerId: seller.id },
    orderBy: { createdAt: "desc" },
    include: ORDER_INCLUDE,
  });
}

/** One order, visible only to the seller it belongs to. `null` otherwise. */
export async function getSellerOrder(
  db: OrderStore,
  userId: string,
  orderId: string
): Promise<OrderWithItems | null> {
  const seller = await getSellerRowForUser(db, userId);
  if (!seller) return null;

  return db.order.findFirst({
    where: { id: orderId, sellerId: seller.id },
    include: ORDER_INCLUDE,
  });
}

export type SalesSnapshot = {
  totalOrders: number;
  pendingOrders: number;
  /** Orders that reached a paid/fulfilling state (driven by the payment phase). */
  paidOrders: number;
  /** Gross collected on paid orders — stays 0 until payments actually run. */
  paidRevenueCents: number;
  unitsSold: number;
  activeListings: number;
  lowStockListings: number;
};

/**
 * Real aggregates for the seller sales screen — counts and sums over the
 * seller's own rows only. Deliberately computed from `orders`/`products`, so
 * the numbers move only when real rows exist; there is no placeholder value.
 */
export async function getSellerSalesSnapshot(db: OrderStore, userId: string): Promise<SalesSnapshot | null> {
  const seller = await getSellerRowForUser(db, userId);
  if (!seller) return null;

  const paidStatuses = ["PAID", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

  const [totalOrders, pendingOrders, paidOrders, revenue, units, activeListings, lowStock] =
    await Promise.all([
      db.order.count({ where: { sellerId: seller.id, status: { not: "CANCELLED" } } }),
      db.order.count({ where: { sellerId: seller.id, status: "PENDING" } }),
      db.order.count({ where: { sellerId: seller.id, status: { in: [...paidStatuses] } } }),
      db.order.aggregate({
        where: { sellerId: seller.id, status: { in: [...paidStatuses] } },
        _sum: { totalCents: true },
      }),
      db.orderItem.aggregate({
        where: { order: { sellerId: seller.id, status: { not: "CANCELLED" } } },
        _sum: { quantity: true },
      }),
      db.product.count({ where: { sellerId: seller.id, status: "ACTIVE" } }),
      db.product.count({ where: { sellerId: seller.id, status: "ACTIVE", quantity: { lte: 3 } } }),
    ]);

  return {
    totalOrders,
    pendingOrders,
    paidOrders,
    paidRevenueCents: revenue._sum.totalCents ?? 0,
    unitsSold: units._sum.quantity ?? 0,
    activeListings,
    lowStockListings: lowStock,
  };
}
