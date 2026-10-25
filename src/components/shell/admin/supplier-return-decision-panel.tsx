"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const NEXT_STATUSES = [
  "APPROVED", "REJECTED", "ITEM_RETURNED", "REFUND_PENDING", "RESOLVED", "CANCELLED",
] as const;

const RESPONSIBILITIES = [
  "UNDETERMINED", "SUPPLIER", "SELLER", "COURIER", "BUYER", "PLATFORM",
] as const;

/** Admin-only return decisions. Refund completion is checked from the DB. */
export function SupplierReturnDecisionPanel({ returnId }: { returnId: string }) {
  const [status, setStatus] = useState<string>("APPROVED");
  const [responsibility, setResponsibility] = useState<string>("UNDETERMINED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/supplier-returns/${returnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          responsibility,
          resolutionNote: note.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setMessage(json.data?.message || json.error || "Unable to update the return request.");
    } catch {
      setMessage("A network error occurred.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 text-xs text-white">
      <label className="flex flex-col gap-1">
        <span className="text-white/50">Next status</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-lg border border-white/10 bg-[#1A1A1A] px-2"
        >
          {NEXT_STATUSES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-white/50">Responsibility</span>
        <select
          value={responsibility}
          onChange={(e) => setResponsibility(e.target.value)}
          className="h-9 rounded-lg border border-white/10 bg-[#1A1A1A] px-2"
        >
          {RESPONSIBILITIES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution / evidence note"
        className="h-9 min-w-48 flex-1 rounded-lg border border-white/10 bg-[#1A1A1A] px-3"
      />
      <Button size="sm" disabled={busy} onClick={submit}>
        {busy ? "Saving..." : "Apply"}
      </Button>
      {message && <p className="w-full text-amber-200">{message}</p>}
    </div>
  );
}
