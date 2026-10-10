import type { OrderStatus } from "@prisma/client";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { cn } from "@/utils";

const TONE: Record<OrderStatus, string> = {
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  CONFIRMED: "bg-cyan/15 text-cyan",
  PAID: "bg-success/15 text-success",
  SHIPPED: "bg-cyan/15 text-cyan",
  DELIVERED: "bg-success/15 text-success",
  COMPLETED: "bg-success/15 text-success",
  CANCELLED: "bg-destructive/15 text-destructive",
  REFUNDED: "bg-destructive/15 text-destructive",
};

/** Colour-coded order status — one look for every screen. */
export function OrderStatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        TONE[status],
        className
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {ORDER_STATUS_LABEL[status] ?? status}
    </span>
  );
}
