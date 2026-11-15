import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Package } from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { SellerOrderCard } from "@/components/shell/seller/seller-order-card";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH, SELLER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import {
  SELLER_ORDER_TABS,
  countSellerOrdersByTab,
  filterSellerOrders,
  parseSellerOrderTab,
} from "@/lib/seller-order-view";
import { getSellerRowForUser, listSellerOrders } from "@/services/order-service";

/** Rendered per request — reads the session (see layout banners). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orders" };

export default async function SellerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { user } = await requireSellerAccess();
  const seller = await getSellerRowForUser(prisma, user.id);
  if (!seller) redirect(BUYER_DASHBOARD_PATH);

  // Scoped inside the service to the caller's OWN sellers row.
  const orders = await listSellerOrders(prisma, user.id);
  if (!orders) redirect(BUYER_DASHBOARD_PATH);

  const tab = parseSellerOrderTab((await searchParams).tab);
  const counts = countSellerOrdersByTab(orders);
  const visible = filterSellerOrders(orders, tab);

  return (
    <Container className="py-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm shipment as soon as a paid parcel is handed to the courier.
          </p>
        </div>
        <Link href={`${SELLER_DASHBOARD_PATH}/sales`} className="text-sm text-primary-400 hover:underline">
          Sales overview →
        </Link>
      </div>

      <nav aria-label="Order status filter" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {SELLER_ORDER_TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? `${SELLER_DASHBOARD_PATH}/orders` : `${SELLER_DASHBOARD_PATH}/orders?tab=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={[
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border px-3.5 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              ].join(" ")}
            >
              {t.label}
              <span className="tabular-nums opacity-80">{counts[t.key]}</span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <EmptyState
          icon={Package}
          title={orders.length === 0 ? "No orders yet." : "No orders in this view."}
          description={
            orders.length === 0
              ? "When buyers order your listings, the orders will show up here for you to fulfil."
              : "Try another status tab."
          }
          actionLabel="View my listings"
          actionHref={`${SELLER_DASHBOARD_PATH}/listings`}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((order) => (
            <SellerOrderCard key={order.id} order={order} detailHref={`${SELLER_DASHBOARD_PATH}/orders/${order.id}`} />
          ))}
        </div>
      )}
    </Container>
  );
}
