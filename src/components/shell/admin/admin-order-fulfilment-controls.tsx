"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { Loader2, ShieldCheck, Truck } from "lucide-react";
import { recordAdminOrderFulfilmentAction } from "@/app/(dashboard)/admin/actions";

export function AdminOrderFulfilmentControls({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [carrierName, setCarrierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const step = status === "PAID" ? "SHIPPED" : status === "SHIPPED" ? "DELIVERED" : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!step || pending) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordAdminOrderFulfilmentAction({
        orderId,
        step,
        reason,
        ...(step === "SHIPPED"
          ? { shipment: { carrierName, trackingNumber, ...(trackingUrl ? { trackingUrl } : {}) } }
          : {}),
      });
      if (!result.success) {
        setError(result.error ?? "Order update failed.");
        return;
      }
      setSuccess(result.data?.changed
        ? `Order ${result.data.orderNumber} recorded as ${step.toLowerCase()}.`
        : "This order already has that status.");
      router.refresh();
    });
  }

  if (!step) {
    return (
      <section aria-label="Admin fulfilment controls" className="glass rounded-2xl p-6">
        <h2 className="font-display text-lg font-medium">Fulfilment oversight</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === "PENDING"
            ? "Payment is not confirmed. The order remains awaiting payment; admin cannot mark it shipped."
            : status === "DELIVERED"
              ? "Delivery has been reported. The buyer must confirm receipt to complete the order."
              : status === "COMPLETED"
                ? "The buyer has confirmed receipt. This order is complete."
                : "No administrative fulfilment change is available for this order status."}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Admin fulfilment controls" className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary-400" aria-hidden />
        <h2 className="font-display text-lg font-medium">Admin fulfilment oversight</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {step === "SHIPPED"
          ? "Use this only after verifying with the seller or courier that the parcel was actually dispatched. This does not change payment status."
          : "Use this only after obtaining delivery evidence. The buyer will still need to confirm physical receipt."}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        {step === "SHIPPED" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Courier / delivery provider
              <input required maxLength={80} value={carrierName} onChange={(e) => setCarrierName(e.target.value)}
                placeholder="e.g. G4S, Fargo, rider"
                className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="text-xs text-muted-foreground">
              Tracking number
              <input required maxLength={100} value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Courier tracking reference"
                className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="text-xs text-muted-foreground sm:col-span-2">
              Tracking link (optional)
              <input type="url" maxLength={500} value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)}
                placeholder="https://courier.example/track/..."
                className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>
        )}
        <label className="block text-xs text-muted-foreground">
          {step === "SHIPPED" ? "Dispatch verification / reason (required)" : "Delivery evidence / reason (required)"}
          <textarea required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={step === "SHIPPED"
              ? "e.g. Confirmed dispatch with courier on phone; tracking reference verified."
              : "e.g. Courier proof of delivery reference and date confirmed with recipient."}
            className="mt-1 min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <button type="submit" disabled={pending}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
          {pending ? "Saving..." : step === "SHIPPED" ? "Record verified dispatch" : "Record verified delivery"}
        </button>
      </form>
      {success && <p role="status" className="mt-3 text-sm text-emerald-500">{success}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        Every admin override is attributed to your admin account and recorded with its reason. Payment, refund and payout records are not modified.
      </p>
    </section>
  );
}
