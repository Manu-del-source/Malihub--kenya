"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { Loader2, Truck } from "lucide-react";
import { updateSellerOrderFulfilment } from "@/app/(dashboard)/seller/orders/actions";

type ShipmentSummary = {
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  status: string;
};

export function SellerOrderActions({
  orderId,
  status,
  shipment,
}: {
  orderId: string;
  status: OrderStatus;
  shipment?: ShipmentSummary | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [carrierName, setCarrierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [handedOver, setHandedOver] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const nextStep = status === "PAID" ? "SHIPPED" : status === "SHIPPED" ? "DELIVERED" : null;

  function updateStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nextStep || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await updateSellerOrderFulfilment({
        orderId,
        step: nextStep,
        ...(nextStep === "SHIPPED"
          ? { shipment: { carrierName, trackingNumber, handedToCourier: handedOver, ...(trackingUrl ? { trackingUrl } : {}) } }
          : {}),
      });
      if (!result.success) {
        setError(result.error ?? "Order update failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      {status === "PENDING" && (
        <p className="text-xs leading-5 text-muted-foreground">
          Awaiting payment. Shipping actions unlock after payment is confirmed.
        </p>
      )}

      {status === "PAID" && !formOpen && (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400 sm:w-auto"
        >
          <Truck className="h-4 w-4" aria-hidden />
          Confirm product shipped
        </button>
      )}

      {status === "PAID" && formOpen && (
        <form onSubmit={updateStatus} className="space-y-3">
          <div>
            <p className="text-sm font-medium">Dispatch order</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Once you have physically handed the parcel to the courier or delivery rider, enter the tracking details and confirm that the product has shipped.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Courier / delivery provider
              <input
                required
                maxLength={80}
                value={carrierName}
                onChange={(event) => setCarrierName(event.target.value)}
                placeholder="e.g. G4S, Wells Fargo, rider"
                className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Tracking number
              <input
                required
                maxLength={100}
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Enter tracking reference"
                className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            Tracking link (optional)
            <input
              type="url"
              pattern="https://.*"
              title="Tracking links must start with https://"
              maxLength={500}
              value={trackingUrl}
              onChange={(event) => setTrackingUrl(event.target.value)}
              placeholder="https://courier.example/track/..."
              className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-xs leading-5 text-foreground">
            <input
              type="checkbox"
              required
              checked={handedOver}
              onChange={(event) => setHandedOver(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>I confirm this parcel has physically been handed to the courier or rider.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !handedOver}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
            {pending ? "Saving..." : "Confirm product shipped & save tracking"}
          </button>
          <button
            type="button"
            onClick={() => setFormOpen(false)}
            disabled={pending}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          </div>
        </form>
      )}

      {status === "SHIPPED" && (
        <div className="space-y-3">
          <div className="text-xs leading-5 text-muted-foreground">
            <p>The order is in transit. Mark it delivered only after the buyer has received it.</p>
            {shipment && (
              <p className="mt-2">
                Courier: <span className="text-foreground">{shipment.carrierName}</span>
                {" · "}Tracking: <span className="font-mono text-foreground">{shipment.trackingNumber}</span>
                {shipment.trackingUrl && (
                  <>
                    {" · "}
                    <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">
                      Track parcel
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
          <form onSubmit={updateStatus}>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
              {pending ? "Updating..." : "Mark as delivered"}
            </button>
          </form>
        </div>
      )}

      {status === "DELIVERED" && (
        <p className="text-xs leading-5 text-muted-foreground">
          Marked delivered. The buyer can now confirm receipt to complete the order.
        </p>
      )}
      {status === "COMPLETED" && <p className="text-xs text-muted-foreground">This order is complete.</p>}
      {status === "CANCELLED" && <p className="text-xs text-muted-foreground">This order was cancelled.</p>}
      {status === "REFUNDED" && <p className="text-xs text-muted-foreground">This order has been refunded.</p>}
      {status === "CONFIRMED" && (
        <p className="text-xs text-muted-foreground">This order has a legacy status. Contact MaliHub support before fulfilling it.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
