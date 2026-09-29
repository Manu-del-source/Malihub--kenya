import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Package, Boxes, Wallet, TriangleAlert, Receipt } from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH, SELLER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { getSellerSalesSnapshot } from "@/services/order-service";
import { formatKes } from "@/utils";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sales" };

export default async function SellerSalesPage() {
  const { user } = await requireSellerAccess();

  const snapshot = await getSellerSalesSnapshot(prisma, user.id);
  if (!snapshot) redirect(BUYER_DASHBOARD_PATH);

  const tiles = [
    {
      key: "orders" as const,
      label: "Orders",
      icon: Receipt,
      value: snapshot.totalOrders.toLocaleString(),
      detail: `${snapshot.pendingOrders} awaiting payment`,
    },
    {
      key: "units" as const,
      label: "Units ordered",
      icon: Boxes,
      value: snapshot.unitsSold.toLocaleString(),
      detail: "Across all non-cancelled orders",
    },
    {
      key: "revenue" as const,
      label: "Paid revenue",
      icon: Wallet,
      value: formatKes(snapshot.paidRevenueCents),
      detail: `${snapshot.paidOrders} paid order${snapshot.paidOrders === 1 ? "" : "s"}`,
    },
    {
      key: "listings" as const,
      label: "Active listings",
      icon: Package,
      value: snapshot.activeListings.toLocaleString(),
      detail:
        snapshot.lowStockListings > 0
          ? `${snapshot.lowStockListings} low on stock`
          : "Stock levels healthy",
    },
  ];

  return (
    <Container className="py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real totals from your orders — nothing here is estimated.
          </p>
        </div>
        <Link
          href={`${SELLER_DASHBOARD_PATH}/orders`}
          className="text-sm text-primary-400 hover:underline"
        >
          Manage orders →
        </Link>
      </div>

      {snapshot.totalOrders === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No sales yet."
          description="Once buyers start ordering your listings, your order totals and units sold will appear here."
          actionLabel="Go to my listings"
          actionHref={`${SELLER_DASHBOARD_PATH}/listings`}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map(({ key, label, icon: Icon, value, detail }) => (
              <div key={key} className="rounded-xl border border-border bg-card p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <p className="mt-3 font-mono text-2xl font-medium tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">{detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Paid revenue counts orders in paid, shipped, delivered or completed state.
              Until the payment phase is live, orders stay in &quot;awaiting payment&quot; and
              this total stays at zero — it never counts money that hasn&apos;t been collected.
            </p>
          </div>

          {snapshot.lowStockListings > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 font-display text-lg font-medium">Low stock</h2>
              <p className="text-sm text-muted-foreground">
                {snapshot.lowStockListings} active listing
                {snapshot.lowStockListings === 1 ? " has" : "s have"} 3 units or fewer left.{" "}
                <Link
                  href={`${SELLER_DASHBOARD_PATH}/listings`}
                  className="text-primary-400 hover:underline"
                >
                  Update inventory →
                </Link>
              </p>
            </div>
          )}
        </>
      )}
    </Container>
  );
}
