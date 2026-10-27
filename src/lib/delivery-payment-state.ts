import { addMoneyCents, isMoneyCents } from "@/lib/money";

/** Never rely on a browser's price or on a status label alone for payment. */
export function isAcceptedDeliveryPayable(order: {
  subtotalCents: number;
  totalCents: number;
  deliveryEstimateCents: number | null;
  deliveryFeeCents: number;
  deliveryFeeStatus: string;
  deliveryFeeAcceptedAt: Date | null;
  deliveryQuoteCents: number | null;
  deliveryQuoteUpdatedAt: Date | null;
  deliveryQuoteVersion: number;
}): boolean {
  const total = addMoneyCents(order.subtotalCents, order.deliveryFeeCents);
  if (total === null || total <= 0 || total !== order.totalCents || !(order.deliveryFeeAcceptedAt instanceof Date) ||
      !Number.isFinite(order.deliveryFeeAcceptedAt.getTime())) return false;
  if (order.deliveryFeeStatus === "ESTIMATED") {
    return isMoneyCents(order.deliveryEstimateCents) && order.deliveryEstimateCents === order.deliveryFeeCents &&
      order.deliveryQuoteVersion === 0 && order.deliveryQuoteCents === null;
  }
  if (order.deliveryFeeStatus === "CONFIRMED") {
    return isMoneyCents(order.deliveryQuoteCents) && order.deliveryQuoteCents === order.deliveryFeeCents &&
      Number.isInteger(order.deliveryQuoteVersion) && order.deliveryQuoteVersion > 0 &&
      order.deliveryQuoteUpdatedAt instanceof Date && Number.isFinite(order.deliveryQuoteUpdatedAt.getTime()) &&
      order.deliveryFeeAcceptedAt.getTime() >= order.deliveryQuoteUpdatedAt.getTime();
  }
  return false; // QUOTED, legacy without recorded consent, or any unknown state
}
