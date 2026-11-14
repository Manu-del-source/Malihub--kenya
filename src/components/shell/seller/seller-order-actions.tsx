"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { Loader2, Truck } from "lucide-react";
import { updateSellerOrderFulfilment } from "@/app/(dashboard)/seller/orders/actions";

export function SellerOrderActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextStep = status === "PAID" ? "SHIPPED" : status === "SHIPPED" ? "DELIVERED" : null;
  const actionLabel = nextStep === "SHIPPED" ? "Mark as shipped" : nextStep === "DELIVERED" ? "Mark as delivered" : null;

  function updateStatus() {
    if (!nextStep || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await updateSellerOrderFulfilment({ orderId, step: nextStep });
      if (!result.success) {
        setError(result.error ?? "Order update failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="max-w-xl text-xs leading-5 text-muted-foreground">
        {status === "PENDING" && "Awaiting payment. Shipping actions unlock after payment is confirmed."}
        {status === "PAID" && "Payment confirmed. Prepare the parcel, then mark it as shipped."}
        {status === "SHIPPED" && "The order is marked as shipped. Mark it delivered once the buyer has received it."}
        {status === "DELIVERED" && "Marked delivered. Waiting for the buyer to confirm completion."}
        {status === "COMPLETED" && "This order is complete."}
        {status === "CANCELLED" && "This order was cancelled."}
        {status === "REFUNDED" && "This order has been refunded."}
        {status === "CONFIRMED" && "This order has a legacy status. Contact MaliHub support before fulfilling it."}
      </p>
      {actionLabel && (
        <button type="button" onClick={updateStatus} disabled={pending}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
          {pending ? "Updating..." : actionLabel}
        </button>
      )}
      {error && <p role="alert" className="w-full text-sm text-red-400">{error}</p>}
    </div>
  );
}
