"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PaystackPaySection } from "@/components/shell/buyer/paystack-pay-section";
import type { BuyerDeliveryQuote } from "@/lib/delivery-quote";
import type { BuyerPaymentSnapshot } from "@/lib/payments/payment-snapshot";
import type { PaystackPhase } from "@/hooks/use-paystack-payment";
import { addMoneyCents, isMoneyCents } from "@/lib/money";
import { formatKes } from "@/utils";

export function DeliveryPaymentSection({ initialQuote, initialSnapshot, sellerName }: {
  initialQuote: BuyerDeliveryQuote; initialSnapshot: BuyerPaymentSnapshot | null; sellerName: string;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState(initialQuote);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshQuote = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/${initialQuote.orderId}/delivery-quote`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true || !body.data) {
        setError(typeof body?.error === "string" ? body.error : "Could not refresh delivery details.");
        return;
      }
      setQuote(body.data as BuyerDeliveryQuote);
      setChecked(false);
      setError(null);
    } catch { setError("Could not refresh delivery details. Check your connection and try again."); }
    finally { setLoading(false); }
  }, [initialQuote.orderId]);

  useEffect(() => {
    void refreshQuote();
    const onFocus = () => void refreshQuote();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshQuote]);

  const refreshedAfterPayment = useRef(false);
  const onPaymentPhase = useCallback((phase: PaystackPhase) => {
    if (phase === "awaiting" && !refreshedAfterPayment.current) {
      // Remove the server-rendered cancellation action once an attempt exists.
      refreshedAfterPayment.current = true;
      router.refresh();
    }
    if (phase === "failed") {
      // A conflict can mean a new quote; an ambiguous failure can still have
      // reserved a provider reference. Refresh both quote and order state.
      void refreshQuote();
      router.refresh();
    }
  }, [refreshQuote, router]);

  async function accept() {
    if (busy || !checked || quote.feeStatus !== "QUOTED" || !isMoneyCents(quote.quoteCents) ||
        !Number.isInteger(quote.quoteVersion) || quote.quoteVersion < 1) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/orders/${quote.orderId}/delivery-quote/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteVersion: quote.quoteVersion, quotedFeeCents: quote.quoteCents }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) {
        const text = typeof body?.error === "string" ? body.error : "Could not accept the quote.";
        await refreshQuote();
        setError(text);
      } else {
        setQuote(body.data as BuyerDeliveryQuote);
        setChecked(false);
        setMessage("Delivery quote accepted. Your order is still unpaid.");
        router.refresh();
      }
    } catch { setError("Could not reach the server. Please try again."); }
    finally { setBusy(false); }
  }

  const proposedTotal = isMoneyCents(quote.quoteCents) ? addMoneyCents(quote.subtotalCents, quote.quoteCents) : null;
  const payable = !loading && !error && quote.orderStatus === "PENDING" && !!quote.acceptedAt &&
    (quote.feeStatus === "ESTIMATED" || quote.feeStatus === "CONFIRMED");

  return (
    <>
      <section className="glass rounded-2xl p-5 text-sm" aria-live="polite">
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-base font-medium">Delivery fee</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshQuote()} disabled={loading || busy}>{loading ? "Checking…" : "Refresh"}</Button>
        </div>
        <p className="mt-2 text-muted-foreground">County: {quote.county ?? "not recorded"}</p>
        <p className="mt-1 text-muted-foreground">Original estimate: {quote.estimateCents === null ? "not recorded" : formatKes(quote.estimateCents)}</p>
        {quote.feeStatus === "QUOTED" && isMoneyCents(quote.quoteCents) ? (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="font-medium">Seller&apos;s revised quote: {formatKes(quote.quoteCents)}</p>
            <p className="mt-1">Revised order total: {proposedTotal === null ? "unavailable" : formatKes(proposedTotal)}</p>
            {quote.quoteNote && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">Seller note: {quote.quoteNote}</p>}
            {quote.quoteUpdatedAt && <p className="mt-1 text-xs text-muted-foreground">Updated {new Date(quote.quoteUpdatedAt).toLocaleString()}</p>}
            <p className="mt-2 text-xs text-muted-foreground">This replaces the estimate. Review and accept it before payment.</p>
            {Number.isInteger(quote.quoteVersion) && quote.quoteVersion > 0 ? (
              <>
                <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={checked} disabled={loading || busy} onChange={(event) => setChecked(event.target.checked)} /><span>I accept this seller delivery quote and revised total.</span></label>
                <Button type="button" size="sm" className="mt-3" onClick={() => void accept()} disabled={!checked || loading || busy || proposedTotal === null}>{busy ? "Accepting…" : "Accept delivery quote"}</Button>
              </>
            ) : <p className="mt-3 text-xs">This older quote needs to be reissued. Ask the seller to send it again before accepting.</p>}
          </div>
        ) : quote.feeStatus === "CONFIRMED" && quote.acceptedAt ? (
          <p className="mt-2 font-medium text-success">Seller quote accepted: {formatKes(quote.feeCents)}</p>
        ) : quote.feeStatus === "ESTIMATED" && quote.acceptedAt ? (
          <p className="mt-2">Accepted estimate: <strong>{formatKes(quote.feeCents)}</strong>. A later seller quote must be accepted before payment.</p>
        ) : <p className="mt-2 text-amber-500">No accepted delivery fee is recorded. Ask the seller for a quote or contact support.</p>}
        {quote.feeStatus === "CONFIRMED" && quote.quoteNote && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">Seller note: {quote.quoteNote}</p>}
        {error && <p role="alert" className="mt-3 text-destructive">{error}</p>}
        {message && <p role="status" className="mt-3 text-success">{message}</p>}
      </section>
      <PaystackPaySection
        order={{ id: quote.orderId, orderNumber: quote.orderNumber, totalCents: quote.totalCents, deliveryQuoteVersion: quote.quoteVersion, sellerName }}
        initialSnapshot={initialSnapshot} disabled={!payable}
        disabledReason={loading ? "Checking the current delivery fee…" : "Review and accept the current delivery fee before payment."}
        refreshOnSuccess onPhaseChange={onPaymentPhase}
      />
    </>
  );
}
