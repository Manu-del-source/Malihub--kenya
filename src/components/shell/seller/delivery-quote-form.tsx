"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { formatKes } from "@/utils";

/** Parse shillings exactly; no floating point rounding in monetary input. */
export function parseKesInput(input: string): number | null {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || value.length > 15) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(MAX_MONEY_CENTS) ? Number(cents) : null;
}

export function DeliveryQuoteForm({ order }: { order: {
  id: string; status: string; county: string | null; address: string | null; estimateCents: number | null;
  quoteCents: number | null; quoteNote: string | null; quoteVersion: number;
  feeStatus: string; acceptedAt: string | null; paymentActive: boolean;
} }) {
  const router = useRouter();
  const [amount, setAmount] = useState(order.quoteCents === null ? "" : (order.quoteCents / 100).toFixed(2));
  const [note, setNote] = useState(order.quoteNote ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = order.status === "PENDING" && !order.paymentActive;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editable) return;
    const amountCents = parseKesInput(amount);
    if (amountCents === null || note.trim().length > 500) {
      setError("Enter a non-negative KSh amount with at most two decimal places, and a note up to 500 characters.");
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/orders/${order.id}/delivery-quote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, note: note.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) {
        setError(typeof body?.error === "string" ? body.error : "Could not submit the quote.");
      } else {
        setMessage(body.data?.changed ? "Quote sent. The buyer must accept it before paying." : "This quote is already current.");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <details className="mt-4 rounded-xl border border-border p-4 text-sm">
      <summary className="cursor-pointer font-medium">Delivery quote · {order.feeStatus === "QUOTED" ? "awaiting buyer" : order.feeStatus === "CONFIRMED" && order.acceptedAt ? "accepted" : order.feeStatus === "ESTIMATED" && order.acceptedAt ? "estimate accepted" : "unconfirmed"}</summary>
      <p className="mt-3 text-muted-foreground">County: {order.county ?? "not recorded"} · Original estimate: {order.estimateCents === null ? "not recorded" : formatKes(order.estimateCents)}</p>
      {order.address && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">Delivery details: {order.address}</p>}
      {order.quoteCents !== null && <p className="mt-1 text-muted-foreground">Current seller quote: {formatKes(order.quoteCents)}</p>}
      {order.quoteCents !== null && order.quoteVersion === 0 && editable && <p className="mt-2 text-amber-500">This older quote must be sent again so the buyer can accept its current version.</p>}
      {!editable && <p className="mt-2 text-amber-500">{order.paymentActive ? "Payment has been started. The delivery price is locked; contact support before changing it." : "Only pending, unpaid orders can be quoted."}</p>}
      <form onSubmit={submit} className="mt-3 space-y-3">
        <label className="block text-xs font-medium">Quote amount (KSh)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editable || busy} required maxLength={15} placeholder="e.g. 250.00" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
        </label>
        <label className="block text-xs font-medium">Note to buyer (optional, 500 characters max)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!editable || busy} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </label>
        <p className="text-xs text-muted-foreground">This note is visible to the buyer. Do not include private costs, credentials or internal notes.</p>
        <Button type="submit" size="sm" disabled={!editable || busy}>{busy ? "Sending…" : "Send quote to buyer"}</Button>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {message && <p role="status" className="text-success">{message}</p>}
      </form>
    </details>
  );
}
