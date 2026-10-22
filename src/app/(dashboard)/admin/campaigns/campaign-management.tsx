"use client";

import { useState, useTransition } from "react";
import { createCampaignAction, setCampaignStatusAction, updateCampaignAction } from "../actions";

type ProductOption = { id: string; title: string; slug: string; priceCents: number; seller: { businessName: string } };
type Campaign = { id: string; status: string; title: string; slug: string; description: string | null; startsAt: string; endsAt: string; products: { productId: string }[] };

export function CampaignManagement({ products, campaigns }: { products: ProductOption[]; campaigns: Campaign[] }) {
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
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setMessage("Choose a valid campaign window; the end must be after the start.");
      return;
    }
    startTransition(async () => {
      const result = await createCampaignAction({ title, slug, description, startsAt: start.toISOString(), endsAt: end.toISOString(), productIds: selected });
      if (!result.success) { setMessage(result.error || "Could not create campaign."); return; }
      window.location.reload();
    });
  }

  function changeStatus(id: string, status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "CANCELLED") {
    setMessage("");
    startTransition(async () => {
      const result = await setCampaignStatusAction({ id, status });
      if (!result.success) { setMessage(result.error || "Could not update campaign."); return; }
      window.location.reload();
    });
  }

  function editCampaign(event: React.FormEvent<HTMLFormElement>, campaign: Campaign) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = new Date(String(form.get("startsAt") || ""));
    const end = new Date(String(form.get("endsAt") || ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setMessage("Choose a valid campaign window; the end must be after the start.");
      return;
    }
    const productIds = form.getAll("productIds").map(String);
    setMessage("");
    startTransition(async () => {
      const result = await updateCampaignAction({
        id: campaign.id,
        title: String(form.get("title") || ""),
        slug: String(form.get("slug") || ""),
        description: String(form.get("description") || ""),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        productIds,
      });
      if (!result.success) { setMessage(result.error || "Could not update campaign."); return; }
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
            <div key={campaign.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-medium">{campaign.title}</p><p className="text-xs text-muted-foreground">{campaign.status}</p></div>
                <div className="flex flex-wrap gap-2">
                  {campaign.status !== "DRAFT" && campaign.status !== "CANCELLED" && campaign.status !== "ENDED" && <button type="button" disabled={pending} onClick={() => changeStatus(campaign.id, "DRAFT")} className="rounded-md border border-border px-3 py-1.5 text-sm">Set draft</button>}
                  {campaign.status !== "CANCELLED" && campaign.status !== "ENDED" && <button type="button" disabled={pending} onClick={() => changeStatus(campaign.id, "CANCELLED")} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>}
                  {campaign.status === "DRAFT" && <button type="button" disabled={pending} onClick={() => changeStatus(campaign.id, "SCHEDULED")} className="rounded-md border border-border px-3 py-1.5 text-sm">Schedule</button>}
                </div>
              </div>
              {campaign.status !== "CANCELLED" && campaign.status !== "ENDED" && (
                <details className="mt-3 rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Edit campaign and product assignments</summary>
                  <form onSubmit={event => editCampaign(event, campaign)} className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1 text-sm">Title<input name="title" required minLength={3} maxLength={100} defaultValue={campaign.title} className="rounded-md border border-border bg-background px-3 py-2" /></label>
                    <label className="grid gap-1 text-sm">URL slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={2} maxLength={80} defaultValue={campaign.slug} className="rounded-md border border-border bg-background px-3 py-2" /></label>
                    <label className="grid gap-1 text-sm md:col-span-2">Description<textarea name="description" maxLength={1000} defaultValue={campaign.description ?? ""} className="rounded-md border border-border bg-background px-3 py-2" rows={2} /></label>
                    <label className="grid gap-1 text-sm">Starts (East Africa time)<input name="startsAt" required type="datetime-local" defaultValue={campaign.startsAt.slice(0, 16)} className="rounded-md border border-border bg-background px-3 py-2" /></label>
                    <label className="grid gap-1 text-sm">Ends (East Africa time)<input name="endsAt" required type="datetime-local" defaultValue={campaign.endsAt.slice(0, 16)} className="rounded-md border border-border bg-background px-3 py-2" /></label>
                    <fieldset className="md:col-span-2">
                      <legend className="mb-2 text-sm font-medium">Assigned eligible listings</legend>
                      <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                        {products.map(product => <label key={product.id} className="flex items-center gap-3 text-sm">
                          <input type="checkbox" name="productIds" value={product.id} defaultChecked={campaign.products.some(p => p.productId === product.id)} />
                          <span className="min-w-0 flex-1">{product.title}<span className="block text-xs text-muted-foreground">{product.seller.businessName}</span></span>
                          <span className="tabular-nums">KES {(product.priceCents / 100).toLocaleString("en-KE")}</span>
                        </label>)}
                      </div>
                    </fieldset>
                    <button disabled={pending} className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50 md:col-span-2">{pending ? "Saving…" : "Save campaign changes"}</button>
                  </form>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
