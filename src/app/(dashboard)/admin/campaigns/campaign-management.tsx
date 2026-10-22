"use client";

import { useState, useTransition } from "react";
import { createCampaignAction, setCampaignStatusAction } from "../actions";

type ProductOption = { id: string; title: string; slug: string; priceCents: number; seller: { businessName: string } };
type Campaign = { id: string; status: string; title: string };

export function CampaignManagement({
  products,
  campaigns,
}: {
  products: ProductOption[];
  campaigns: Campaign[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      const result = await createCampaignAction({
        title, slug, description, startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(), productIds: selected,
      });
      if (!result.success) {
        setMessage(result.error || "Could not create campaign.");
        return;
      }
      setMessage("Campaign created.");
      window.location.reload();
    });
  }

  function changeStatus(id: string, status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "CANCELLED") {
    setMessage("");
    startTransition(async () => {
      const result = await setCampaignStatusAction({ id, status });
      if (!result.success) {
        setMessage(result.error || "Could not update campaign.");
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border p-6">
        <h2 className="text-xl font-medium">Create campaign</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose active listings from verified sellers. Campaigns do not change product prices.</p>
        <form onSubmit={createCampaign} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">Campaign title
            <input required minLength={3} maxLength={100} value={title} onChange={e => setTitle(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">URL slug
            <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={2} maxLength={80} value={slug} onChange={e => setSlug(e.target.value)} placeholder="e.g. october-fashion" className="rounded-md border border-border bg-background px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">Description
            <textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2" rows={3} />
          </label>
          <label className="grid gap-1 text-sm">Starts (East Africa time)
            <input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">Ends (East Africa time)
            <input required type="datetime-local" min={startsAt || undefined} value={endsAt} onChange={e => setEndsAt(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2" />
          </label>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Assign products ({selected.length} selected)</legend>
            {products.length === 0 ? <p className="text-sm text-muted-foreground">No eligible products are currently available. Verify and activate seller listings first.</p> : (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {products.map(product => (
                  <label key={product.id} className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={selected.includes(product.id)} onChange={e => setSelected(old => e.target.checked ? [...old, product.id] : old.filter(id => id !== product.id))} />
                    <span className="min-w-0 flex-1"><span className="block">{product.title}</span><span className="text-xs text-muted-foreground">{product.seller.businessName}</span></span>
                    <span className="tabular-nums">KES {(product.priceCents / 100).toLocaleString("en-KE")}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {message && <p role="status" className="text-sm md:col-span-2">{message}</p>}
          <button disabled={pending} className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50 md:col-span-2">{pending ? "Saving…" : "Create campaign"}</button>
        </form>
      </section>
      <section className="rounded-xl border border-border p-6">
        <h2 className="text-xl font-medium">Campaign controls</h2>
        <div className="mt-4 divide-y divide-border">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="font-medium">{campaign.title}</p><p className="text-xs text-muted-foreground">{campaign.status}</p></div>
              <div className="flex flex-wrap gap-2">
                {campaign.status !== "DRAFT" && campaign.status !== "CANCELLED" && <button disabled={pending} onClick={() => changeStatus(campaign.id, "DRAFT")} className="rounded-md border border-border px-3 py-1.5 text-sm">Set draft</button>}
                {campaign.status !== "CANCELLED" && <button disabled={pending} onClick={() => changeStatus(campaign.id, "CANCELLED")} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>}
                {campaign.status === "DRAFT" && <button disabled={pending} onClick={() => changeStatus(campaign.id, "SCHEDULED")} className="rounded-md border border-border px-3 py-1.5 text-sm">Schedule</button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
