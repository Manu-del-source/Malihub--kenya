import type { OrderStatus } from "@prisma/client";

/**
 * Buyer-facing progress for an order — presentation only.
 *
 * Steps are marked done strictly from recorded data: "Delivered" needs a
 * verified `deliveredAt`, never just a status guess, and there is deliberately
 * no "out for delivery" step because nothing in the data model records one.
 * Cancelled / refunded orders have no progress; callers show a banner instead.
 */
export type OrderProgressStep = {
  key: "placed" | "paid" | "shipped" | "delivered";
  label: string;
  done: boolean;
  at: Date | null;
};

export type OrderProgress =
  | { kind: "steps"; steps: OrderProgressStep[]; currentIndex: number }
  | { kind: "closed"; label: "Cancelled" | "Refunded" };

const PAID_OR_LATER: readonly OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED", "COMPLETED"];
const SHIPPED_OR_LATER: readonly OrderStatus[] = ["SHIPPED", "DELIVERED", "COMPLETED"];

export function buildOrderProgress(input: {
  status: OrderStatus;
  createdAt: Date;
  paidAt?: Date | null;
  deliveredAt?: Date | null;
}): OrderProgress {
  const { status } = input;
  if (status === "CANCELLED") return { kind: "closed", label: "Cancelled" };
  if (status === "REFUNDED") return { kind: "closed", label: "Refunded" };

  const delivered = Boolean(input.deliveredAt);
  const steps: OrderProgressStep[] = [
    { key: "placed", label: "Order placed", done: true, at: input.createdAt },
    {
      key: "paid",
      label: "Paid",
      done: PAID_OR_LATER.includes(status),
      at: input.paidAt ?? null,
    },
    { key: "shipped", label: "Shipped", done: SHIPPED_OR_LATER.includes(status), at: null },
    { key: "delivered", label: "Delivered", done: delivered, at: input.deliveredAt ?? null },
  ];

  const firstOpen = steps.findIndex((step) => !step.done);
  return { kind: "steps", steps, currentIndex: firstOpen === -1 ? steps.length - 1 : firstOpen };
}

/** One short line for the headline above the stepper. */
export function orderProgressHeadline(progress: OrderProgress): string {
  if (progress.kind === "closed") return progress.label;
  const current = progress.steps[progress.currentIndex];
  if (progress.steps.every((step) => step.done)) return "Delivered";
  switch (current?.key) {
    case "paid":
      return "Awaiting payment";
    case "shipped":
      return "Paid — preparing your order";
    case "delivered":
      return "On the way";
    default:
      return "Order placed";
  }
}
