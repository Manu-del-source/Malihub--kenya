"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const REASONS = [
  { value: "DAMAGED", label: "Item arrived damaged" },
  { value: "INCORRECT", label: "Wrong item delivered" },
  { value: "COUNTERFEIT", label: "Item is not as described / counterfeit" },
  { value: "UNDELIVERED", label: "Item was not delivered" },
  { value: "OTHER", label: "Other issue" },
] as const;

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `return-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Buyer-initiated return/dispute request. Payout hold is applied server-side. */
export function SupplierReturnForm({ fulfilmentId }: { fulfilmentId: string }) {
  const [reason, setReason] = useState<string>("DAMAGED");
  const [reasonNote, setReasonNote] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKey = useRef<string>("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    if (!idempotencyKey.current) idempotencyKey.current = newKey();
    try {
      const res = await fetch("/api/buyer/supplier-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfilmentId,
          reason,
          reasonNote: reasonNote.trim(),
          evidenceNote: evidenceNote.trim() || undefined,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setMessage(json.data?.message || json.error || "The request could not be submitted.");
      if (res.ok) {
        setReasonNote("");
        setEvidenceNote("");
      }
    } catch {
      setMessage("A network error occurred. Please try again; a duplicate request will be prevented.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-foreground/10 bg-card p-4 text-sm text-foreground">
      <p className="font-medium">Report a delivery, return or cancellation issue</p>
      <p className="text-xs text-muted-foreground">
        Your request opens a buyer-protection review. It does not automatically refund your payment or guarantee a replacement.
      </p>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-10 w-full rounded-lg border border-foreground/10 bg-muted px-3 text-sm"
      >
        {REASONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <textarea
        value={reasonNote}
        onChange={(e) => setReasonNote(e.target.value)}
        minLength={8}
        maxLength={2000}
        required
        placeholder="Describe the issue (at least 8 characters)"
        className="min-h-20 w-full rounded-lg border border-foreground/10 bg-muted p-3 text-sm"
      />
      <Input
        type="text"
        value={evidenceNote}
        onChange={(e) => setEvidenceNote(e.target.value)}
        maxLength={2000}
        placeholder="Evidence note or reference (optional)"
        className="h-10 border-foreground/10 bg-muted text-sm"
      />
      {message && <p className="text-xs text-amber-200">{message}</p>}
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? "Submitting..." : "Submit request"}
      </Button>
    </form>
  );
}
