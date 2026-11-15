"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { confirmBuyerOrderReceipt } from "@/app/(dashboard)/buyer/orders/actions";

export function ConfirmOrderReceipt({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmReceipt() {
    if (!confirmed || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmBuyerOrderReceipt(orderId);
      if (!result.success) {
        setError(result.error ?? "Receipt confirmation failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="glass rounded-2xl p-5 text-sm">
      <h2 className="font-display text-base font-medium">Confirm receipt</h2>
      <p className="mt-2 text-muted-foreground">
        Only confirm after you have physically received and checked your order. This completes the order.
        If anything is missing, damaged or incorrect, contact MaliHub support before confirming.
      </p>
      <label className="mt-4 flex items-start gap-2 text-xs leading-5">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={pending}
          className="mt-1 h-4 w-4 rounded border-border accent-primary"
        />
        <span>I confirm that I have received this order in satisfactory condition.</span>
      </label>
      <button
        type="button"
        onClick={confirmReceipt}
        disabled={!confirmed || pending}
        className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
        {pending ? "Confirming..." : "Confirm received"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
