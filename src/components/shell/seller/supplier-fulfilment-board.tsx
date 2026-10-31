"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKes } from "@/utils";
import { SUPPLIER_FULFILMENT_LABEL } from "@/lib/dropshipping/fulfilment-state-machine";
import type { SupplierFulfilmentStatus } from "@prisma/client";

export type SupplierFulfilmentBoardItem = {
  id: string;
  reference: string;
  orderId: string;
  status: SupplierFulfilmentStatus;
  quantity: number;
  unitRetailCents: number;
  unitCostMinor: number;
  currency: string;
  totalCostMinor: number;
  costStatus: string;
  supplierReference: string | null;
  purchaseReference: string | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  expectedDispatchAt: string | null;
  lastStatusChangedAt: string;
  createdAt: string;
  updatedAt: string;
  supplierProduct: { title: string; sku: string | null; stockStatus: string; stockVerifiedAt: string | null };
  supplier: { id: string; name: string; status: string; region: string };
  order: { id: string; orderNumber: string; status: string; totalCents: number };
  product: { id: string; title: string; slug: string };
  purchase: {
    id: string;
    status: string;
    amountMinor: number;
    currency: string;
    paymentResponsibility: string;
    paymentTerms: string | null;
    confirmedAt: string | null;
    paidAt: string | null;
    reconciledAt: string | null;
  } | null;
  returnRequest: { id: string; status: string; reason: string; requestedAt: string } | null;
};

type RowForm = {
  costKes: string;
  supplierReference: string;
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string;
  reason: string;
  deliveryEvidenceNote: string;
  paymentReference: string;
  reconciliationNote: string;
};

const emptyForm: RowForm = {
  costKes: "",
  supplierReference: "",
  carrierName: "",
  trackingNumber: "",
  trackingUrl: "",
  reason: "",
  deliveryEvidenceNote: "",
  paymentReference: "",
  reconciliationNote: "",
};

function idempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SupplierFulfilmentBoard({
  initialItems,
  isAdmin = false,
}: {
  initialItems: SupplierFulfilmentBoardItem[];
  isAdmin?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [forms, setForms] = useState<Record<string, RowForm>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const formFor = (id: string) => forms[id] ?? emptyForm;
  const setForm = (id: string, patch: Partial<RowForm>) =>
    setForms((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyForm), ...patch } }));

  async function postJson(url: string, body: unknown): Promise<{ ok: boolean; text: string; data?: { to?: string } }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { ok: false, text: json.error || json.message || "The request was not accepted." };
    }
    return { ok: true, text: json.data?.message || "Updated.", data: json.data };
  }

  async function transition(item: SupplierFulfilmentBoardItem, action: string) {
    const f = formFor(item.id);
    const key = `${item.id}:${action}`;
    setBusy(key);
    setMessage(null);
    const cost = Number.parseFloat(f.costKes);
    const body: Record<string, unknown> = { action, idempotencyKey: idempotencyKey() };
    if (action === "CONFIRM_AVAILABILITY") {
      if (!Number.isFinite(cost) || cost < 0) {
        setMessage({ kind: "error", text: "Enter the final supplier unit cost in KES." });
        setBusy(null);
        return;
      }
      body.finalUnitCostMinor = Math.round(cost * 100);
    }
    if (action === "RECORD_PURCHASE") body.supplierReference = f.supplierReference || undefined;
    if (action === "RECORD_DISPATCH" || action === "RECORD_IN_TRANSIT") {
      body.carrierName = f.carrierName || undefined;
      body.trackingNumber = f.trackingNumber || undefined;
      body.trackingUrl = f.trackingUrl || undefined;
    }
    if (action === "RECORD_DELIVERY") body.deliveryEvidenceNote = f.deliveryEvidenceNote || undefined;
    if (["REPORT_FAILURE", "CANCEL", "RETRY"].includes(action)) body.reason = f.reason || undefined;

    const result = await postJson(`/api/supplier-fulfilments/${item.id}/transition`, body);
    if (result.ok) {
      const to = result.data?.to as SupplierFulfilmentStatus | undefined;
      setItems((prev) =>
        prev.map((row) => (row.id === item.id && to ? { ...row, status: to } : row)),
      );
      setMessage({ kind: "ok", text: `Task ${item.reference} updated.` });
    } else {
      setMessage({ kind: "error", text: result.text });
    }
    setBusy(null);
  }

  async function purchase(item: SupplierFulfilmentBoardItem, action: "CONFIRM" | "FAIL" | "RECONCILE") {
    const f = formFor(item.id);
    const key = `${item.id}:purchase:${action}`;
    setBusy(key);
    setMessage(null);
    const body: Record<string, unknown> = { action };
    if (action === "CONFIRM") body.purchaseReference = f.supplierReference || undefined;
    if (action === "FAIL") body.reason = f.reason || undefined;
    if (action === "RECONCILE") {
      body.paymentReference = f.paymentReference || undefined;
      body.reconciliationNote = f.reconciliationNote || undefined;
    }
    const result = await postJson(`/api/supplier-fulfilments/${item.id}/purchase`, body);
    setMessage(
      result.ok
        ? { kind: "ok", text: `Supplier purchase updated for ${item.reference}.` }
        : { kind: "error", text: result.text },
    );
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            message.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
          role="status"
        >
          {message.text}
        </div>
      )}
      {items.length === 0 && (
        <div className="rounded-2xl border border-foreground/10 bg-muted p-8 text-center text-sm text-muted-foreground">
          No supplier fulfilment tasks yet. Tasks appear here only after a provider-verified payment.
        </div>
      )}
      {items.map((item) => {
        const f = formFor(item.id);
        const isOverdue =
          item.expectedDispatchAt &&
          new Date(item.expectedDispatchAt).getTime() < Date.now() &&
          ["AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED"].includes(item.status);
        return (
          <section
            key={item.id}
            className="rounded-2xl border border-foreground/10 bg-card p-5 text-foreground"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={item.status === "FAILED" ? "default" : "verified"} className={item.status === "FAILED" ? "bg-red-500/15 text-red-300" : undefined}>
                    {SUPPLIER_FULFILMENT_LABEL[item.status]}
                  </Badge>
                  {isOverdue && <Badge className="bg-amber-500/15 text-amber-200">Overdue dispatch</Badge>}
                </div>
                <h2 className="mt-2 font-display text-lg font-medium">
                  {item.supplierProduct.title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.reference} · Order {item.order.orderNumber} · Qty {item.quantity} · Supplier {item.supplier.name}
                </p>
              </div>
              <Link
                href={isAdmin ? `/admin/orders/${item.order.id}` : `/seller/orders/${item.order.id}`}
                className="text-xs text-primary hover:underline"
              >
                View order
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-foreground/5 bg-muted p-3 text-xs sm:grid-cols-4">
              <div>
                <span className="text-muted-foreground">Retail / unit</span>
                <p className="font-mono">{formatKes(item.unitRetailCents)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Supplier unit cost</span>
                <p className="font-mono">{formatKes(item.unitCostMinor)} · {item.costStatus}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total supplier cost</span>
                <p className="font-mono">{formatKes(item.totalCostMinor)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Purchase</span>
                <p className="font-mono">{item.purchase?.status ?? "NOT_CREATED"}</p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-amber-300">
              Supplier stock is a snapshot, not a reservation. Confirm availability and final cost before purchase. No supplier payment is sent automatically.
            </p>
            {item.returnRequest && (
              <p className="mt-2 text-xs text-amber-200">
                Return/dispute: {item.returnRequest.status} ({item.returnRequest.reason}). Payout eligibility is held while unresolved.
              </p>
            )}
            {item.failureReason && (
              <p className="mt-2 text-xs text-red-300">Failure reason: {item.failureReason}</p>
            )}
            {item.trackingNumber && (
              <p className="mt-2 text-xs text-foreground/80">
                Courier: {item.carrierName ?? "Carrier"} · {item.trackingNumber}
                {item.trackingUrl ? ` · ${item.trackingUrl}` : ""}
              </p>
            )}
            {item.deliveredAt && (
              <p className="mt-2 text-xs text-emerald-300">
                Admin-reviewed delivery recorded at {new Date(item.deliveredAt).toLocaleString()}.
              </p>
            )}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Final supplier unit cost (KES)"
                value={f.costKes}
                onChange={(e) => setForm(item.id, { costKes: e.target.value })}
                className="h-9 border-foreground/10 bg-muted text-xs"
              />
              <Input
                type="text"
                placeholder="Supplier order / purchase reference"
                value={f.supplierReference}
                onChange={(e) => setForm(item.id, { supplierReference: e.target.value })}
                className="h-9 border-foreground/10 bg-muted text-xs"
              />
              <Input
                type="text"
                placeholder="Carrier name"
                value={f.carrierName}
                onChange={(e) => setForm(item.id, { carrierName: e.target.value })}
                className="h-9 border-foreground/10 bg-muted text-xs"
              />
              <Input
                type="text"
                placeholder="Tracking number"
                value={f.trackingNumber}
                onChange={(e) => setForm(item.id, { trackingNumber: e.target.value })}
                className="h-9 border-foreground/10 bg-muted text-xs"
              />
              <Input
                type="text"
                placeholder="Reason / evidence / payment ref"
                value={f.reason}
                onChange={(e) => setForm(item.id, { reason: e.target.value })}
                className="h-9 border-foreground/10 bg-muted text-xs sm:col-span-2"
              />
              {isAdmin && (
                <Input
                  type="text"
                  placeholder="Reviewed delivery evidence (admin only)"
                  value={f.deliveryEvidenceNote}
                  onChange={(e) => setForm(item.id, { deliveryEvidenceNote: e.target.value })}
                  className="h-9 border-foreground/10 bg-muted text-xs sm:col-span-2"
                />
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => transition(item, "CONFIRM_AVAILABILITY")}>
                Confirm availability & cost
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => purchase(item, "CONFIRM")}>
                Confirm purchase
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => transition(item, "RECORD_PURCHASE")}>
                Record supplier order
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => transition(item, "RECORD_DISPATCH")}>
                Record dispatch
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => transition(item, "RECORD_IN_TRANSIT")}>
                In transit
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => purchase(item, "RECONCILE")}>
                Reconcile purchase
              </Button>
              <Button size="sm" variant="secondary" className="text-red-300" disabled={busy !== null} onClick={() => transition(item, "REPORT_FAILURE")}>
                Report failure
              </Button>
              {isAdmin && (
                <>
                  <Button size="sm" disabled={busy !== null} onClick={() => transition(item, "RECORD_DELIVERY")}>
                    Record reviewed delivery
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => transition(item, "CANCEL")}>
                    Cancel task
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => transition(item, "RETRY")}>
                    Approve retry
                  </Button>
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
