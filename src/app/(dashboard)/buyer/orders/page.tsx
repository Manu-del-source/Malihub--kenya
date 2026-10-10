import Link from "next/link";
import { OrderStatusPill } from "@/components/shared/order-status-pill";
import type { Metadata } from "next";
import { Package } from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listBuyerOrders } from "@/services/order-service";
import { formatKes, timeAgo } from "@/utils";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your orders" };


export default async function BuyerOrdersPage() {
  const { user } = await requireUser();

  // Scoped to this session's application user inside the service — there is
  // no caller-supplied buyer id to tamper with.
  const orders = await listBuyerOrders(prisma, user.id);

  return (
    <Container className="py-10">
      <h1 className="mb-1 font-display text-3xl font-medium">Your orders</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {orders.length === 0
          ? "No orders yet"
          : `${orders.length} order${orders.length === 1 ? "" : "s"}`}
      </p>

      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No orders yet."
          description="When you check out, every order and its status will show up here."
          actionLabel="Discover products →"
          actionHref="/marketplace"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/buyer/orders/${order.id}`}
              className="glass rounded-2xl p-6 transition-colors hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                  <OrderStatusPill status={order.status} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {timeAgo(order.createdAt)}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 flex-wrap gap-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <span className="max-w-[14rem] truncate text-sm text-foreground/90">
                        {item.product.title}
                      </span>
                      <span className="text-xs text-muted-foreground">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="text-right">
                  <p className="font-mono text-base font-medium tabular-nums">
                    {formatKes(order.totalCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">{order.seller.businessName}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
