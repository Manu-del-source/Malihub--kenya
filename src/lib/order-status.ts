import type { OrderStatus } from "@prisma/client";

/** Human labels for the `OrderStatus` lifecycle — one source for every screen. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Statuses that represent money actually collected (driven by the payment phase). */
export const PAID_ORDER_STATUSES: readonly OrderStatus[] = [
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
];

export function isPaidOrderStatus(status: OrderStatus): boolean {
  return PAID_ORDER_STATUSES.includes(status);
}
