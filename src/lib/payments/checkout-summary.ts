/**
 * Checkout summary — a pure projection of the server's cart into the shape the
 * checkout screen renders.
 *
 * ─── Why it exists ──────────────────────────────────────────────────────────
 * `checkoutCart` creates ONE ORDER PER SELLER (Order.sellerId is required), so
 * the checkout screen has to show both the whole cart and the seller split
 * before the buyer commits. That projection is the same computation the cart
 * page used to do inline; extracting it here keeps it pure, unit-testable, and
 * — importantly — driven by values that came from `getCart`, never from a
 * client. No price is recomputed from user input anywhere in this module.
 *
 * Unavailable lines are excluded from every total (they cannot be checked
 * out), but they are still returned so the screen can name them.
 */

import { addMoneyCents, isMoneyCents } from "@/lib/money";

export type CheckoutSummaryLine = {
  id: string;
  productId: string;
  title: string;
  slug: string;
  imageUrl: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  isAvailable: boolean;
  stockAvailable: number;
};

export type CheckoutSummaryGroup = {
  sellerId: string;
  sellerName: string;
  lines: CheckoutSummaryLine[];
  subtotalCents: number;
};

export type CheckoutSummary = {
  groups: CheckoutSummaryGroup[];
  /** Distinct sellers — i.e. how many orders checkout will create. */
  sellerCount: number;
  itemCount: number;
  unavailableCount: number;
  /** False if a line, seller subtotal, or combined cart total cannot be represented safely. */
  amountsValid: boolean;
  subtotalCents: number;
  /**
   * Merchandise total before the county estimate is loaded. Checkout adds
   * one server-provided delivery estimate per seller order for display.
   */
  totalCents: number;
};

/** The subset of a server cart line this projection needs (structurally typed). */
export type CartLineLike = {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  isAvailable: boolean;
  stockAvailable: number;
  product: {
    title: string;
    slug: string;
    images: Array<{ url: string }>;
    seller: { id: string; businessName: string };
  };
};

export function buildCheckoutSummary(lines: readonly CartLineLike[]): CheckoutSummary {
  const groups = new Map<string, CheckoutSummaryGroup>();
  let amountsValid = true;

  for (const line of lines) {
    const rawTotal = line.unitPriceCents * line.quantity;
    const validLine = Number.isSafeInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 9999 &&
      isMoneyCents(line.unitPriceCents) && line.unitPriceCents > 0 && isMoneyCents(rawTotal);
    if (line.isAvailable && !validLine) amountsValid = false;
    const lineTotalCents = line.isAvailable && validLine ? rawTotal : 0;
    const group = groups.get(line.product.seller.id) ?? {
      sellerId: line.product.seller.id,
      sellerName: line.product.seller.businessName,
      lines: [],
      subtotalCents: 0,
    };

    group.lines.push({
      id: line.id,
      productId: line.productId,
      title: line.product.title,
      slug: line.product.slug,
      imageUrl: line.product.images[0]?.url ?? "",
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents,
      isAvailable: line.isAvailable,
      stockAvailable: line.stockAvailable,
    });
    const nextGroupTotal = addMoneyCents(group.subtotalCents, lineTotalCents);
    if (nextGroupTotal === null) amountsValid = false;
    else group.subtotalCents = nextGroupTotal;
    groups.set(line.product.seller.id, group);
  }

  const ordered = [...groups.values()];
  // Each seller subtotal must fit the DB Int column. The cart-wide sum may
  // exceed it because it represents multiple separately payable orders, but
  // it still has to remain a safe integer for exact presentation.
  let subtotalCents = 0;
  for (const group of ordered) {
    const next = subtotalCents + group.subtotalCents;
    if (!Number.isSafeInteger(next)) amountsValid = false;
    else subtotalCents = next;
  }

  return {
    groups: ordered,
    sellerCount: ordered.length,
    itemCount: lines.length,
    unavailableCount: lines.filter((line) => !line.isAvailable).length,
    amountsValid,
    subtotalCents,
    totalCents: subtotalCents,
  };
}
