import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Buyer cart — server-side domain logic.
 *
 * ─── Identity ───────────────────────────────────────────────────────────────
 * Every function takes the `userId` of the *authenticated application user*.
 * Callers must derive it from the server session (never from the request
 * body), and every query below additionally scopes by that `userId`, so one
 * buyer can only ever read or mutate their own `cart_items` rows even if a
 * caller passes the wrong id by mistake. There is no `sellerId`, price, or
 * ownership field anywhere in a cart input: prices come from the `products`
 * row at read time, never from the client.
 *
 * ─── Validation ─────────────────────────────────────────────────────────────
 * The product must exist and be `ACTIVE`; a quantity must be an integer
 * within [1, stock]. Inventory is `products.quantity` — the seller's listed
 * stock — and the cart refuses to hold more than that so checkout can't be
 * used to reserve units the seller never had. Rejections throw {@link CartError}
 * with user-safe copy; unexpected failures propagate untouched so callers can
 * log them rather than flattening every failure into "invalid input".
 *
 * ─── Store injection ────────────────────────────────────────────────────────
 * The same dependency-injection shape `account-provisioning.ts` uses: callers
 * pass a Prisma handle (`prisma` in production, an in-memory fake in tests),
 * which is what makes the ownership rules unit-testable without a database.
 */

export type CartErrorCode = "not_found" | "invalid" | "unavailable";

/** A user-fixable cart problem, with copy that is safe to show in the UI. */
export class CartError extends Error {
  readonly code: CartErrorCode;

  constructor(message: string, code: CartErrorCode = "invalid") {
    super(message);
    this.name = "CartError";
    this.code = code;
  }
}

/** The Prisma handles cart operations need. */
export type CartStore = Pick<PrismaClient, "cartItem" | "product">;

/** Cart row + the listing relation every cart view needs. */
const CART_INCLUDE = {
  product: {
    include: {
      images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
      // `id` is included alongside the display fields because checkout groups
      // the cart by seller (the order service creates one order per seller —
      // see `checkoutCart`) and the grouping key must come from the product
      // row, never from the client.
      seller: { select: { id: true, businessName: true, verificationStatus: true } },
    },
  },
} satisfies Prisma.CartItemInclude;

export type CartItemWithProduct = Prisma.CartItemGetPayload<{
  include: typeof CART_INCLUDE;
}>;

export type CartLine = {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  /** False when the listing left the marketplace while it sat in the cart. */
  isAvailable: boolean;
  /** Units the seller still has; the cap for any quantity change. */
  stockAvailable: number;
  product: CartItemWithProduct["product"];
};

export type CartView = {
  items: CartLine[];
  /** All rows in the cart, including unavailable ones. */
  itemCount: number;
  /** Sum of the available lines only — what checkout would charge today. */
  subtotalCents: number;
  /** Lines whose listing is no longer purchasable; the UI must surface these. */
  unavailableCount: number;
};

export type CartSummary = {
  itemCount: number;
  subtotalCents: number;
};

/** Hard cap per cart line — mirrors the listing form's `quantity` ceiling. */
const MAX_CART_QUANTITY = 9999;

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) {
    throw new CartError("Enter a valid quantity (at least 1).");
  }
}

/**
 * Loads a buyer's cart with product context.
 *
 * Priced from the *current* `products` rows, so a price change made after an
 * item was added is reflected immediately — the cart never caches a price.
 */
export async function getCart(db: CartStore, userId: string): Promise<CartView> {
  const rows = await db.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: CART_INCLUDE,
  });

  const items: CartLine[] = rows.map((row: CartItemWithProduct) => {
    const isAvailable = row.product.status === "ACTIVE";
    return {
      id: row.id,
      productId: row.productId,
      quantity: row.quantity,
      unitPriceCents: row.product.priceCents,
      lineTotalCents: isAvailable ? row.product.priceCents * row.quantity : 0,
      isAvailable,
      stockAvailable: Math.max(0, row.product.quantity),
      product: row.product,
    };
  });

  return {
    items,
    itemCount: items.length,
    subtotalCents: items.reduce((sum, line) => sum + line.lineTotalCents, 0),
    unavailableCount: items.filter((line) => !line.isAvailable).length,
  };
}

/** Lightweight projection for dashboards and navigation badges. */
export async function getCartSummary(db: CartStore, userId: string): Promise<CartSummary> {
  const rows = await db.cartItem.findMany({
    where: { userId, product: { status: "ACTIVE" } },
    select: {
      quantity: true,
      product: { select: { priceCents: true } },
    },
  });

  return {
    itemCount: rows.length,
    subtotalCents: rows.reduce(
      (sum, row: { quantity: number; product: { priceCents: number } }) =>
        sum + row.quantity * row.product.priceCents,
      0
    ),
  };
}

/** Fetches the purchasable listing behind a cart operation. */
async function requireActiveProduct(db: CartStore, productId: string) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true, quantity: true, priceCents: true, title: true },
  });
  if (!product) {
    throw new CartError("That listing no longer exists.", "not_found");
  }
  if (product.status !== "ACTIVE") {
    throw new CartError(`"${product.title}" is no longer available.`, "unavailable");
  }
  return product;
}

/**
 * Adds `quantity` units of a listing to the buyer's cart, creating the row
 * when it is the first add. A second add *sums* into the existing row and is
 * validated against stock in one step, so two adds can never overshoot what
 * the seller listed.
 */
export async function addToCart(
  db: CartStore,
  userId: string,
  productId: string,
  quantity = 1
): Promise<CartView> {
  assertQuantity(quantity);
  const product = await requireActiveProduct(db, productId);

  const existing = await db.cartItem.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true, quantity: true },
  });

  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > product.quantity) {
    throw new CartError(
      `Only ${product.quantity} left in stock for "${product.title}".`,
      "unavailable"
    );
  }

  if (existing) {
    await db.cartItem.update({
      where: { id: existing.id },
      data: { quantity: nextQuantity },
    });
  } else {
    try {
      await db.cartItem.create({ data: { userId, productId, quantity } });
    } catch (error) {
      // Lost a first-add race: a concurrent request created this buyer's row
      // between our read and our write. The (userId, productId) unique index
      // guarantees there is exactly one row — merge into it the same way the
      // existing-row path would, instead of surfacing a raw constraint error.
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.cartItem.findUnique({
        where: { userId_productId: { userId, productId } },
        select: { id: true, quantity: true },
      });
      if (!raced) throw error;
      const merged = raced.quantity + quantity;
      if (merged > product.quantity) {
        throw new CartError(
          `Only ${product.quantity} left in stock for "${product.title}".`,
          "unavailable"
        );
      }
      await db.cartItem.update({ where: { id: raced.id }, data: { quantity: merged } });
    }
  }

  return getCart(db, userId);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Sets an existing line to an absolute quantity. Stock and availability are
 * re-validated against the *current* product row — a listing that sold out or
 * was deactivated while the cart sat open still cannot be bumped up.
 */
export async function updateCartItem(
  db: CartStore,
  userId: string,
  productId: string,
  quantity: number
): Promise<CartView> {
  assertQuantity(quantity);
  const product = await requireActiveProduct(db, productId);

  const existing = await db.cartItem.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  if (!existing) {
    throw new CartError("That item is not in your cart.", "not_found");
  }

  if (quantity > product.quantity) {
    throw new CartError(
      `Only ${product.quantity} left in stock for "${product.title}".`,
      "unavailable"
    );
  }

  await db.cartItem.update({ where: { id: existing.id }, data: { quantity } });
  return getCart(db, userId);
}

/**
 * Removes one line. Deliberately tolerant of a missing row (idempotent) and
 * does not require the product to still be active — a buyer must always be
 * able to clear an unavailable item from their cart.
 */
export async function removeFromCart(
  db: CartStore,
  userId: string,
  productId: string
): Promise<CartView> {
  await db.cartItem.deleteMany({ where: { userId, productId } });
  return getCart(db, userId);
}
