import type { OrderStatus } from "@prisma/client";

export const SELLER_ORDER_TABS = [
  { key: "all", label: "All orders" },
  { key: "awaiting-payment", label: "Awaiting payment" },
  { key: "ready-to-dispatch", label: "Ready to dispatch" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "completed", label: "Completed" },
  { key: "cancelled-refunded", label: "Cancelled / refunded" },
] as const;

export type SellerOrderTabKey = (typeof SELLER_ORDER_TABS)[number]["key"];

const TAB_STATUSES: Record<Exclude<SellerOrderTabKey, "all">, readonly OrderStatus[]> = {
  "awaiting-payment": ["PENDING", "CONFIRMED"],
  "ready-to-dispatch": ["PAID"],
  shipped: ["SHIPPED"],
  delivered: ["DELIVERED"],
  completed: ["COMPLETED"],
  "cancelled-refunded": ["CANCELLED", "REFUNDED"],
};

export function parseSellerOrderTab(value: string | string[] | undefined): SellerOrderTabKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return SELLER_ORDER_TABS.some((t) => t.key === raw) ? (raw as SellerOrderTabKey) : "all";
}

export function filterSellerOrders<T extends { status: OrderStatus }>(
  orders: readonly T[],
  tab: SellerOrderTabKey
): T[] {
  if (tab === "all") return [...orders];
  const allowed = TAB_STATUSES[tab];
  return orders.filter((o) => allowed.includes(o.status));
}

export function countSellerOrdersByTab(
  orders: readonly { status: OrderStatus }[]
): Record<SellerOrderTabKey, number> {
  const counts = { all: orders.length } as Record<SellerOrderTabKey, number>;
  for (const tab of SELLER_ORDER_TABS) {
    if (tab.key !== "all") counts[tab.key] = filterSellerOrders(orders, tab.key).length;
  }
  return counts;
}

/** A one-line, plain-language next step so sellers needn't open other pages. */
export function sellerNextStep(status: OrderStatus): string {
  switch (status) {
    case "PENDING":
    case "CONFIRMED":
      return "Waiting for the buyer's payment. Do not dispatch yet.";
    case "PAID":
      return "Payment confirmed. Pack the parcel, hand it to the courier, then confirm it shipped.";
    case "SHIPPED":
      return "In transit. Confirm delivery once the courier reports it delivered.";
    case "DELIVERED":
      return "Delivered. Waiting for the buyer to confirm receipt.";
    case "COMPLETED":
      return "Buyer confirmed receipt. Nothing more to do.";
    case "CANCELLED":
      return "This order was cancelled.";
    case "REFUNDED":
      return "This order was refunded.";
  }
}

const PAYMENT_LABEL: Record<string, string> = {
  PENDING: "Payment pending",
  PROCESSING: "Payment processing",
  SUCCESS: "Payment confirmed",
  SUCCEEDED: "Payment confirmed",
  PAID: "Payment confirmed",
  FAILED: "Payment failed",
  CANCELLED: "Payment cancelled",
  REFUNDED: "Refunded",
};

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "No payment yet";
  return PAYMENT_LABEL[status] ?? status;
}
