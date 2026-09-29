import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Package } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH, SELLER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import {
  getSellerRowForUser,
  listSellerOrders,
} from "@/services/order-service";
import { formatKes, timeAgo } from "@/utils";
import { ORDER_STATUS_LABEL, isPaidOrderStatus } from "@/lib/order-status";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orders" };

export default async function SellerOrdersPage() {
  const { user } = await requireSellerAccess();

  const seller = await getSellerRowForUser(prisma, user.id);
  if (!seller) redirect(BUYER_DASHBOARD_PATH);

  // Scoped inside the service to the caller's OWN sellers row — no
  // seller id ever travels through the request.
  const orders = await listSellerOrders(prisma, user.id);
  if (!orders) redirect(BUYER_DASHBOARD_PATH);

  return (
    <Container className="py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Orders containing your listings — {orders.length} total
          </p>
        </div>
        <Link
          href={`${SELLER_DASHBOARD_PATH}/sales`}
          className="text-sm text-primary-400 hover:underline"
        >
          Sales overview →
        </Link>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No orders yet."
          description="When buyers order your listings, the orders will show up here for you to fulfil."
          actionLabel="View my listings"
          actionHref={`${SELLER_DASHBOARD_PATH}/listings`}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <div key={order.id} className="glass rounded-2xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                  <Badge variant={isPaidOrderStatus(order.status) ? "primary" : "default"}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">{timeAgo(order.createdAt)}</span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {order.buyer.profile?.fullName ?? "A buyer"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {order.items
                      .map(
                        (item) =>
                          `${item.product.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`
                      )
                      .join(", ")}
                  </p>
                </div>
                <p className="font-mono text-base font-medium tabular-nums">
                  {formatKes(order.totalCents)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Container>
  );
}
