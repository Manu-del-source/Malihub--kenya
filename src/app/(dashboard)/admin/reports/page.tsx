import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { Container } from "@/components/ui/container";
import { requireAdministrator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRevenueReport } from "@/services/revenue-service";
import { REVENUE_PRESETS, parseRevenuePreset, resolveRevenueRange } from "@/lib/revenue/date-range";
import { formatKsh } from "@/lib/revenue/format";
import type { RevenueBreakdownRow } from "@/lib/revenue/calculate";

/**
 * `/admin/reports` — MaliHub's real earnings, separated from customer payments.
 * Read-only: no payment, refund, settlement, payout or commission-rate writes.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revenue — admin" };

type Params = Promise<{ range?: string | string[]; from?: string | string[]; to?: string | string[] }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-medium tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: RevenueBreakdownRow[] }) {
  return (
    <section className="glass rounded-2xl p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Name</th>
                <th className="py-1 pr-3 text-right font-medium">Orders</th>
                <th className="py-1 pr-3 text-right font-medium">Merchandise</th>
                <th className="py-1 pr-3 text-right font-medium">MaliHub commission</th>
                <th className="py-1 text-right font-medium">Seller share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border">
                  <td className="py-1.5 pr-3">{r.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.orders}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatKsh(r.merchandiseCents)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatKsh(r.netCommissionCents)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{formatKsh(r.netSellerShareCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Params }) {
  await requireAdministrator();
  const sp = await searchParams;
  const preset = parseRevenuePreset(sp.range);
  const range = resolveRevenueRange(preset, new Date(), { from: first(sp.from), to: first(sp.to) });
  const { report, truncated, generatedAt } = await getRevenueReport(prisma, range);
  const s = report.summary;
  const w = report.warnings;

  return (
    <Container className="py-8 sm:py-10">
      <h1 className="font-display text-3xl font-medium">Revenue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Orders paid in <strong>{range.label}</strong> (Kenya time). Customer payments are not MaliHub revenue; only the
        commission is.
      </p>

      <nav aria-label="Date range" className="-mx-4 my-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {REVENUE_PRESETS.filter((p) => p.key !== "custom").map((p) => (
          <Link
            key={p.key}
            href={`/admin/reports?range=${p.key}`}
            aria-current={range.preset === p.key ? "page" : undefined}
            className={[
              "shrink-0 whitespace-nowrap rounded-full border border-border px-3.5 py-2 text-sm font-medium",
              range.preset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <form method="get" action="/admin/reports" className="mb-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value="custom" />
        <label className="text-xs text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={first(sp.from)} required className="mt-1 block h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={first(sp.to)} required className="mt-1 block h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground" />
        </label>
        <button type="submit" className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Apply custom range
        </button>
      </form>

      {range.error && <p role="alert" className="mb-4 text-sm text-red-400">{range.error} Showing the last 30 days.</p>}

      {(!w.hasDefaultRule || w.unconfiguredCommissionOrderIds.length > 0) && (
        <div role="alert" className="mb-4 flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {!w.hasDefaultRule
              ? "No active DEFAULT commission rule is configured, so commission cannot be calculated for orders without a seller or category rule. "
              : ""}
            {w.unconfiguredCommissionOrderIds.length} order(s) in this period have no applicable commission rule. They are
            counted as sales but excluded from commission and seller earnings. No rate has been assumed.
          </p>
        </div>
      )}
      {truncated && (
        <p role="alert" className="mb-4 text-sm text-amber-400">
          More than 5,000 payments matched; totals are incomplete. Narrow the date range.
        </p>
      )}
      {w.duplicatePaymentOrderIds.length > 0 && (
        <p className="mb-4 text-sm text-amber-400">
          {w.duplicatePaymentOrderIds.length} order(s) have more than one successful payment record. Only the first was counted.
        </p>
      )}

      <section aria-label="Headline metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label="Gross merchandise sales" value={formatKsh(s.grossMerchandiseSalesCents)} note="Paid orders; item price × qty; delivery excluded" />
        <Tile label="Completed merchandise sales" value={formatKsh(s.completedMerchandiseSalesCents)} note="Buyer confirmed receipt" />
        <Tile label="MaliHub commission earned" value={formatKsh(s.commissionEarnedCents)} note="Completed orders, before reversals" />
        <Tile label="Pending commission" value={formatKsh(s.pendingCommissionCents)} note="Paid, not yet completed; net of refunds" />
        <Tile label="Seller earnings payable" value={formatKsh(s.sellerEarningsPayableCents)} note={`Completed orders, net of refunds. Still pending: ${formatKsh(s.sellerEarningsPendingCents)}`} />
        <Tile label="Refunds and commission reversals" value={`${formatKsh(s.refundsCents)} / ${formatKsh(s.commissionReversalsCents)}`} note="Completed refunds / commission reversed" />
        <Tile label="Net platform revenue" value={formatKsh(s.netPlatformRevenueCents)} note="Earned commission − reversals on earned" />
        <Tile
          label="Payment processing fees"
          value={s.ordersWithProviderFeeData ? formatKsh(s.paymentProcessingFeesCents) : "Not recorded"}
          note={`Actual provider data for ${s.ordersWithProviderFeeData} of ${s.totalOrders} orders. Not deducted above.`}
        />
        <Tile label="Total orders" value={String(s.totalOrders)} note="Paid orders only" />
        <Tile label="Average order value" value={s.averageOrderValueCents === null ? "—" : formatKsh(s.averageOrderValueCents)} note="Merchandise ÷ paid orders" />
        <Tile label="Delivery charges (separate)" value={formatKsh(s.deliveryChargesCents)} note="Not MaliHub revenue" />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Breakdown title="By seller" rows={report.bySeller} />
        <Breakdown title="By payment provider" rows={report.byProvider} />
        <Breakdown title="By order status" rows={report.byStatus} />
      </div>

      <section className="glass mt-6 rounded-2xl p-4">
        <h2 className="mb-1 text-sm font-semibold">How each order was calculated</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every figure above is the sum of these rows. Rates come from configured commission rules, never from this page.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {["Order", "Seller", "Status", "Provider / txn", "Merchandise", "Delivery", "Rule", "Commission", "Reversal", "Net commission", "Seller share"].map((h) => (
                  <th key={h} className="py-1 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.orderId} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 font-mono"><Link className="text-primary-400 hover:underline" href={`/admin/orders/${l.orderId}`}>{l.orderNumber}</Link></td>
                  <td className="py-1.5 pr-3">{l.sellerName}</td>
                  <td className="py-1.5 pr-3">{l.status}</td>
                  <td className="py-1.5 pr-3 text-xs">{l.provider}<br /><span className="font-mono">{l.providerTransactionId ?? "—"}</span></td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">{formatKsh(l.merchandiseCents)}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">{formatKsh(l.deliveryFeeCents)}</td>
                  <td className="py-1.5 pr-3 text-xs">{l.commissionConfigured ? l.appliedRules.map((r) => `${r.scope} ${r.description}`).join("; ") : "No rule configured"}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">{l.commissionConfigured ? formatKsh(l.commissionCents) : "—"}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">{formatKsh(l.commissionReversalCents)}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">{l.commissionConfigured ? formatKsh(l.netCommissionCents) : "—"}</td>
                  <td className="py-1.5 font-mono tabular-nums">{l.commissionConfigured ? formatKsh(l.netSellerShareCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        Generated {generatedAt.toISOString()}. Sales are dated by successful payment time. Refunds are applied to merchandise
        first (the refund record does not itemise delivery). Delivery charges are reported separately and are not treated as
        MaliHub revenue.
      </p>
    </Container>
  );
}
