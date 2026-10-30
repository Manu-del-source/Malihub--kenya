"use client";

import { useState } from "react";
import { CalendarClock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

type Lead = {
  id: string; companyName: string; contactName: string; email: string; phone: string;
  location: string | null; categories: string[]; catalogueUrl: string | null; websiteUrl: string | null;
  message: string | null; status: string; internalNotes: string | null; wholesaleTerms: string | null;
  deliveryTerms: string | null; followUpAt: string | null; createdAt: string;
};

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "NEGOTIATING", "VERIFICATION_PENDING", "ONBOARDED", "DECLINED"];
const fieldClass = "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white";

export function SupplierEnquiryManager({ lead }: { lead: Lead }) {
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.internalNotes ?? "");
  const [wholesale, setWholesale] = useState(lead.wholesaleTerms ?? "");
  const [delivery, setDelivery] = useState(lead.deliveryTerms ?? "");
  const [followUp, setFollowUp] = useState(lead.followUpAt ? new Date(lead.followUpAt).toISOString().slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/supplier-enquiries/${lead.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status, internalNotes: notes || null, wholesaleTerms: wholesale || null,
          deliveryTerms: delivery || null, followUpAt: followUp ? new Date(followUp).toISOString() : null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Could not save changes.");
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save changes.");
    } finally { setBusy(false); }
  }

  return (
    <article className="rounded-2xl border border-white/10 bg-[#151515] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{lead.companyName}</h2>
          <p className="mt-1 text-sm text-white/60">{lead.contactName} · {lead.location || "Location not supplied"}</p>
          <p className="mt-1 text-sm"><a className="text-[#D8B66A] hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> · <a className="text-[#D8B66A] hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a></p>
          <p className="mt-2 text-xs text-white/45">Received {new Date(lead.createdAt).toLocaleString()}</p>
        </div>
        <span className="rounded-full border border-[#B8934A]/30 bg-[#B8934A]/10 px-3 py-1 text-xs text-[#E6C98B]">{lead.status.replaceAll("_", " ")}</span>
      </div>
      <p className="mt-4 text-sm text-white/70">Categories: {lead.categories.join(", ")}</p>
      {lead.message && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/60">{lead.message}</p>}
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        {lead.catalogueUrl && <a className="text-[#D8B66A] hover:underline" href={lead.catalogueUrl} target="_blank" rel="noreferrer">Open catalogue</a>}
        {lead.websiteUrl && <a className="text-[#D8B66A] hover:underline" href={lead.websiteUrl} target="_blank" rel="noreferrer">Open website</a>}
      </div>
      <div className="mt-5 grid gap-4 border-t border-white/10 pt-5 md:grid-cols-2">
        <label className="text-xs font-medium text-white/60">Pipeline status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClass}>
            {statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-white/60"><span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Follow-up date</span>
          <input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={fieldClass} />
        </label>
        <label className="text-xs font-medium text-white/60">Wholesale price / commercial terms (internal only)
          <textarea rows={3} value={wholesale} onChange={(e) => setWholesale(e.target.value)} className={fieldClass} placeholder="Record agreed wholesale price list, currency, minimum order quantities and price validity." />
        </label>
        <label className="text-xs font-medium text-white/60">Delivery / fulfilment agreement (internal only)
          <textarea rows={3} value={delivery} onChange={(e) => setDelivery(e.target.value)} className={fieldClass} placeholder="Record who prepares orders, courier arrangement, delivery charges, counties and dispatch expectations." />
        </label>
        <label className="text-xs font-medium text-white/60 md:col-span-2">Internal notes (not visible to supplier or marketplace users)
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={fieldClass} placeholder="Verification progress, call notes, documents requested and next steps." />
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-white/50">{message}</p>
        <Button size="sm" onClick={save} disabled={busy}><Save className="h-4 w-4" /> {busy ? "Saving..." : "Save review"}</Button>
      </div>
    </article>
  );
}
