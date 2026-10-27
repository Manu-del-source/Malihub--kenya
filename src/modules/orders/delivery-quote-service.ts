import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { BuyerDeliveryQuote } from "@/lib/delivery-quote";
import { addMoneyCents, isMoneyCents, MAX_MONEY_CENTS } from "@/lib/money";
import { acceptDeliveryQuoteSchema, deliveryQuoteSchema } from "@/lib/validations/delivery";

export type DeliveryStore = Pick<PrismaClient, "order" | "seller" | "payment" | "$transaction">;

export class DeliveryQuoteError extends Error {
  constructor(message: string, readonly code: "not_found" | "invalid" | "conflict" | "stale_quote") {
    super(message);
    this.name = "DeliveryQuoteError";
  }
}

const deliverySelect = {
  id: true, orderNumber: true, buyerId: true, sellerId: true, status: true,
  deliveryCounty: true, subtotalCents: true, totalCents: true,
  deliveryEstimateCents: true, deliveryFeeCents: true, deliveryFeeStatus: true,
  deliveryFeeAcceptedAt: true, deliveryQuoteCents: true, deliveryQuoteNote: true,
  deliveryQuoteUpdatedAt: true, deliveryQuoteVersion: true,
} satisfies Prisma.OrderSelect;
type DeliveryRow = Prisma.OrderGetPayload<{ select: typeof deliverySelect }>;

export function buyerDeliveryProjection(order: DeliveryRow): BuyerDeliveryQuote {
  return {
    orderId: order.id, orderNumber: order.orderNumber, orderStatus: order.status,
    county: order.deliveryCounty, subtotalCents: order.subtotalCents, totalCents: order.totalCents,
    estimateCents: order.deliveryEstimateCents, feeCents: order.deliveryFeeCents,
    feeStatus: order.deliveryFeeStatus, acceptedAt: order.deliveryFeeAcceptedAt?.toISOString() ?? null,
    quoteCents: order.deliveryQuoteCents, quoteNote: order.deliveryQuoteNote,
    quoteUpdatedAt: order.deliveryQuoteUpdatedAt?.toISOString() ?? null,
    quoteVersion: order.deliveryQuoteVersion,
  };
}

/** Same order-keyed lock as payment settlement; held to transaction commit. */
export async function lockDeliveryOrder(tx: Pick<Prisma.TransactionClient, "$executeRaw">, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
}

async function assertNoPaymentAttempt(tx: Prisma.TransactionClient, orderId: string) {
  // Paystack does not expose a cancellation/expiry guarantee in this
  // integration. Once any checkout has been issued, never change its amount,
  // even if an attempt was later reported failed: an old access code cannot
  // safely be revoked by changing a local database status.
  const payment = await tx.payment.findFirst({
    where: { orderId },
    select: { id: true },
  });
  if (payment) throw new DeliveryQuoteError(
    "Payment has already been started for this order. Contact support before changing delivery.", "conflict"
  );
}

export async function readBuyerDeliveryQuote(db: DeliveryStore, userId: string, orderId: string) {
  const order = await db.order.findFirst({ where: { id: orderId, buyerId: userId }, select: deliverySelect });
  return order ? buyerDeliveryProjection(order) : null;
}

/** Only the seller owning the order can submit a buyer-visible quote. */
export async function submitDeliveryQuote(
  db: DeliveryStore,
  params: { userId: string; orderId: string; amountCents: number; note?: string }
): Promise<{ changed: boolean; buyerId: string; orderNumber: string }> {
  const parsed = deliveryQuoteSchema.safeParse({ amountCents: params.amountCents, ...(params.note !== undefined ? { note: params.note } : {}) });
  if (!parsed.success) throw new DeliveryQuoteError("Enter a valid delivery amount and note (up to 500 characters).", "invalid");
  const { amountCents } = parsed.data;
  const note = parsed.data.note || null;

  return db.$transaction(async (tx) => {
    await lockDeliveryOrder(tx, params.orderId);
    const seller = await tx.seller.findUnique({ where: { userId: params.userId }, select: { id: true } });
    if (!seller) throw new DeliveryQuoteError("Order not found.", "not_found");
    const order = await tx.order.findFirst({ where: { id: params.orderId, sellerId: seller.id }, select: deliverySelect });
    if (!order) throw new DeliveryQuoteError("Order not found.", "not_found");
    if (order.status !== "PENDING") throw new DeliveryQuoteError("Delivery quotes can only be changed on unpaid pending orders.", "conflict");
    await assertNoPaymentAttempt(tx, order.id);
    if (addMoneyCents(order.subtotalCents, amountCents) === null) {
      throw new DeliveryQuoteError("The quoted order total is too large.", "invalid");
    }
    // Double-submitting an identical versioned quote is a no-op, including
    // after acceptance. An unversioned legacy quote must be reissued even if
    // identical, so the buyer can explicitly accept its new version. A changed
    // amount OR note also requires renewed buyer consent.
    if (order.deliveryQuoteVersion > 0 &&
        (order.deliveryFeeStatus === "QUOTED" || order.deliveryFeeStatus === "CONFIRMED") &&
        order.deliveryQuoteCents === amountCents && order.deliveryQuoteNote === note) {
      return { changed: false, buyerId: order.buyerId, orderNumber: order.orderNumber };
    }
    if (!Number.isInteger(order.deliveryQuoteVersion) || order.deliveryQuoteVersion < 0 || order.deliveryQuoteVersion >= MAX_MONEY_CENTS) {
      throw new DeliveryQuoteError("This quote cannot be updated. Please contact support.", "conflict");
    }
    const updated = await tx.order.updateMany({
      where: { id: order.id, sellerId: seller.id, status: "PENDING", deliveryQuoteVersion: order.deliveryQuoteVersion },
      data: {
        deliveryQuoteCents: amountCents, deliveryQuoteNote: note, deliveryQuoteUpdatedAt: new Date(),
        deliveryQuoteVersion: order.deliveryQuoteVersion + 1, deliveryFeeStatus: "QUOTED", deliveryFeeAcceptedAt: null,
      },
    });
    if (updated.count !== 1) throw new DeliveryQuoteError("The order changed. Refresh and try again.", "conflict");
    return { changed: true, buyerId: order.buyerId, orderNumber: order.orderNumber };
  });
}

/** Version AND amount are compared with the server row; neither controls price. */
export async function acceptDeliveryQuote(
  db: DeliveryStore,
  params: { userId: string; orderId: string; quoteVersion: number; quotedFeeCents: number }
): Promise<BuyerDeliveryQuote> {
  const parsed = acceptDeliveryQuoteSchema.safeParse({ quoteVersion: params.quoteVersion, quotedFeeCents: params.quotedFeeCents });
  if (!parsed.success) throw new DeliveryQuoteError("Select a valid current delivery quote.", "invalid");
  return db.$transaction(async (tx) => {
    await lockDeliveryOrder(tx, params.orderId);
    const order = await tx.order.findFirst({ where: { id: params.orderId, buyerId: params.userId }, select: deliverySelect });
    if (!order) throw new DeliveryQuoteError("Order not found.", "not_found");
    if (order.status !== "PENDING") throw new DeliveryQuoteError("This order is no longer awaiting payment.", "conflict");
    if (order.deliveryQuoteVersion !== parsed.data.quoteVersion || order.deliveryQuoteCents !== parsed.data.quotedFeeCents) {
      throw new DeliveryQuoteError("The delivery quote changed. Refresh and review the latest quote.", "stale_quote");
    }
    if (!isMoneyCents(order.deliveryQuoteCents) || !order.deliveryQuoteUpdatedAt) {
      throw new DeliveryQuoteError("There is no valid quote to accept.", "conflict");
    }
    if (order.deliveryFeeStatus === "CONFIRMED" && order.deliveryFeeCents === order.deliveryQuoteCents && order.deliveryFeeAcceptedAt) {
      return buyerDeliveryProjection(order);
    }
    if (order.deliveryFeeStatus !== "QUOTED") throw new DeliveryQuoteError("There is no current quote to accept.", "conflict");
    await assertNoPaymentAttempt(tx, order.id);
    const total = addMoneyCents(order.subtotalCents, order.deliveryQuoteCents);
    if (total === null || total === 0) throw new DeliveryQuoteError("This order total is invalid. Please contact support.", "conflict");
    const acceptedAt = new Date(Math.max(Date.now(), order.deliveryQuoteUpdatedAt.getTime()));
    const updated = await tx.order.updateMany({
      where: { id: order.id, buyerId: params.userId, status: "PENDING", deliveryFeeStatus: "QUOTED", deliveryQuoteVersion: parsed.data.quoteVersion, deliveryQuoteCents: parsed.data.quotedFeeCents },
      data: { deliveryFeeCents: order.deliveryQuoteCents, totalCents: total, deliveryFeeStatus: "CONFIRMED", deliveryFeeAcceptedAt: acceptedAt },
    });
    if (updated.count !== 1) throw new DeliveryQuoteError("The delivery quote changed. Refresh and review it again.", "stale_quote");
    return buyerDeliveryProjection({ ...order, deliveryFeeCents: order.deliveryQuoteCents, totalCents: total, deliveryFeeStatus: "CONFIRMED", deliveryFeeAcceptedAt: acceptedAt });
  });
}
