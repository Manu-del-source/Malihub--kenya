import type { OrderStatus } from "@prisma/client";
import { ORDER_TRANSITIONS, isTerminalOrderStatus } from "@/lib/order-state-machine";

/**
 * Human labels for the `OrderStatus` lifecycle — one source for every screen.
 *
 * The *rules* about which status may follow which live in
 * `@/lib/order-state-machine`; this file is presentation only. Nothing here
 * decides a transition, and nothing here should be used to.
 */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Awaiting payment",
  // Reserved legacy value. Kept renderable so any row that carries it still
  // displays something sensible, but no code in the application writes it or
  // transitions out of it — see the CONFIRMED note in order-state-machine.ts.
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

export { isTerminalOrderStatus, ORDER_TRANSITIONS };

