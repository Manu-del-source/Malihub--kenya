"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { KENYA_COUNTIES } from "@/lib/constants";
import { Button } from "@/components/ui/button";

type Address = {
  id: string; label: string; recipientName: string; phone: string; county: string;
  subCounty: string | null; town: string; area: string | null; building: string | null;
  landmark: string | null; instructions: string | null; isDefault: boolean;
};
type Draft = Omit<Address, "id" | "isDefault"> & { isDefault: boolean };
const emptyDraft: Draft = {
  label: "Home", recipientName: "", phone: "", county: "", subCounty: "",
  town: "", area: "", building: "", landmark: "", instructions: "", isDefault: false,
};

export function AddressBookView({ initialAddresses }: { initialAddresses: Address[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startAdd() {
    setEditingId(null);
    setDraft({ ...emptyDraft, isDefault: addresses.length === 0 });
    setError(null);
    setShowForm(true);
  }
  function startEdit(address: Address) {
    setEditingId(address.id);
    setDraft({
      label: address.label, recipientName: address.recipientName, phone: address.phone,
      county: address.county, subCounty: address.subCounty ?? "", town: address.town,
      area: address.area ?? "", building: address.building ?? "", landmark: address.landmark ?? "",
      instructions: address.instructions ?? "", isDefault: address.isDefault,
    });
    setError(null);
    setShowForm(true);
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(editingId ? `/api/account/addresses/${editingId}` : "/api/account/addresses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) throw new Error(body?.error || "Could not save this address.");
      const saved = body.data as Address;
      setAddresses((current) => {
        const next = editingId ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
        return saved.isDefault ? next.map((item) => item.id === saved.id ? item : { ...item, isDefault: false }) : next;
      });
      setShowForm(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this address.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(address: Address) {
    if (!window.confirm(`Delete ${address.label} address?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/account/addresses/${address.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) throw new Error(body?.error || "Could not delete this address.");
      const next = addresses.filter((item) => item.id !== address.id);
      if (address.isDefault && next.length) next[0] = { ...next[0]!, isDefault: true };
      setAddresses(next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:py-9">
      <Link href="/account" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Account
      </Link>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-300">Delivery preferences</p>
          <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">My addresses</h1>
          <p className="mt-1 text-sm text-muted-foreground">Save destinations for faster checkout.</p>
        </div>
        {!showForm && <Button onClick={startAdd} className="shrink-0"><Plus className="mr-1 h-4 w-4" /> Add address</Button>}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}

      {showForm ? (
        <form onSubmit={save} className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">{editingId ? "Edit address" : "Add delivery address"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Address label
              <input required maxLength={40} value={draft.label} onChange={(e) => update("label", e.target.value)} placeholder="Home, Work…" className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm">Recipient name
              <input required minLength={2} maxLength={100} value={draft.recipientName} onChange={(e) => update("recipientName", e.target.value)} autoComplete="name" className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm">Phone number
              <input required type="tel" maxLength={16} value={draft.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+254 7XX XXX XXX" autoComplete="tel" className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm">County
              <select required value={draft.county} onChange={(e) => update("county", e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3">
                <option value="">Select county</option>
                {KENYA_COUNTIES.map((county) => <option key={county} value={county}>{county}</option>)}
              </select>
            </label>
            <label className="text-sm">Sub-county <span className="text-muted-foreground">(optional)</span>
              <input maxLength={100} value={draft.subCounty ?? ""} onChange={(e) => update("subCounty", e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm">Town / Ward
              <input required maxLength={100} value={draft.town} onChange={(e) => update("town", e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm">Estate / Area <span className="text-muted-foreground">(optional)</span>
              <input maxLength={120} value={draft.area ?? ""} onChange={(e) => update("area", e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm">Building / Street <span className="text-muted-foreground">(optional)</span>
              <input maxLength={160} value={draft.building ?? ""} onChange={(e) => update("building", e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
            <label className="text-sm sm:col-span-2">Nearby landmark / delivery instructions <span className="text-muted-foreground">(optional)</span>
              <textarea maxLength={300} rows={2} value={draft.landmark ?? ""} onChange={(e) => update("landmark", e.target.value)} placeholder="Near the market, opposite the school…" className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2" />
            </label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isDefault} onChange={(e) => update("isDefault", e.target.checked)} />
            Set as my default address
          </label>
          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save address"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      ) : addresses.length ? (
        <div className="space-y-3">
          {addresses.map((address) => (
            <article key={address.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-300"><MapPin className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{address.label}</h2>
                    {address.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary-300"><Star className="h-3 w-3" /> Default</span>}
                  </div>
                  <p className="mt-1 text-sm">{address.recipientName} · {address.phone}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[address.building, address.area, address.town, address.subCounty, address.county].filter(Boolean).join(", ")}
                  </p>
                  {address.landmark && <p className="mt-1 text-xs text-muted-foreground">Near {address.landmark}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => startEdit(address)} aria-label="Edit address" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void remove(address)} disabled={busy} aria-label="Delete address" className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-12 text-center">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-display text-lg font-semibold">No saved addresses</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add a delivery address once and use it whenever you shop.</p>
          <Button className="mt-4" onClick={startAdd}><Plus className="mr-1 h-4 w-4" /> Add your first address</Button>
        </div>
      )}
      <p className="mt-5 text-xs text-muted-foreground">Pickup stations will appear here only when MaliHub has verified collection locations in your area.</p>
    </div>
  );
}
