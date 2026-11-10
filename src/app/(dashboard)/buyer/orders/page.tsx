import Link from "next/link";
import type { Metadata } from "next";
import { Package } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listBuyerOrders } from "@/services/order-service";
import { formatKes, timeAgo } from "@/utils";
import { ORDER_STATUS_LABEL, isPaidOrderStatus } from "@/lib/order-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your orders" };

const FILTERS = [
  { label: "All orders", value: "all" },
  { label: "Unpaid", value: "unpaid" },
  { label: "To be shipped", value: "to-ship" },
  { label: "Shipped", value: "shipped" },
  { label: "To be reviewed", value: "to-review" },
  { label: "Returns / refunds", value: "returns" },
] as const;

type OrderFilter = (typeof FILTERS)[number]["value"];

export default async function BuyerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { user } = await requireUser();
  const params = await searchParams;
  const requestedFilter = params.status ?? "all";
  const filter: OrderFilter = FILTERS.some((item) => item.value === requestedFilter)
    ? (requestedFilter as OrderFilter)
    : "all";

  // The service scopes every order to the authenticated buyer. Additional
  // review/case lookups below use that same session user id.
  const orders = await listBuyerOrders(prisma, user.id);
  let filteredOrders = orders;

  if (filter === "unpaid") {
    filteredOrders = orders.filter((order) => order.status === "PENDING");
  } else if (filter === "to-ship") {
    filteredOrders = orders.filter((order) => order.status === "CONFIRMED" || order.status === "PAID");
  } else if (filter === "shipped") {
    filteredOrders = orders.filter((order) => order.status === "SHIPPED");
  } else if (filter === "to-review") {
    const reviewed = await prisma.orderReview.findMany({
      where: { authorId: user.id },
      select: { orderId: true },
    });
    const reviewedIds = new Set(reviewed.map((review) => review.orderId));
    filteredOrders = orders.filter(
      (order) =>
        (order.status === "DELIVERED" || order.status === "COMPLETED") &&
        !reviewedIds.has(order.id),
    );
  } else if (filter === "returns") {
    const cases = await prisma.buyerProtectionCase.findMany({
      where: { buyerId: user.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
      select: { orderId: true },
    });
    const caseOrderIds = new Set(cases.map((item) => item.orderId));
    filteredOrders = orders.filter((order) => caseOrderIds.has(order.id));
  }

  return (
    <Container className="py-6 pb-24 sm:py-10 md:pb-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 font-display text-2xl font-medium sm:text-3xl">Your orders</h1>
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? `${orders.length} order${orders.length === 1 ? "" : "s"}`
              : `${filteredOrders.length} ${FILTERS.find((item) => item.value === filter)?.label.toLowerCase()} order${filteredOrders.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link href="/account" className="text-sm text-muted-foreground transition hover:text-primary-300">Account</Link>
      </div>

      <nav aria-label="Filter orders" className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((item) => {
          const active = filter === item.value;
          return (
            <Link
              key={item.value}
              href={item.value === "all" ? "/buyer/orders" : `/buyer/orders?status=${item.value}`}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No orders yet."
          description="When you check out, every order and its status will show up here."
          actionLabel="Discover products →"
          actionHref="/marketplace"
        />
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 font-medium">Nothing in this section yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Orders matching this status will appear here.</p>
          <Link href="/buyer/orders" className="mt-4 inline-flex rounded-full border border-primary/40 px-4 py-2 text-sm text-primary-300 hover:bg-primary/10">View all orders</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:gap-4">
          {filteredOrders.map((order) => (
            <Link
              key={order.id}
              href={`/buyer/orders/${order.id}`}
              className="glass rounded-2xl p-4 transition-colors hover:border-primary/40 sm:p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                  <Badge variant={isPaidOrderStatus(order.status) ? "primary" : "default"}>
                    {ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">{timeAgo(order.createdAt)}</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 flex-wrap gap-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <span className="max-w-[14rem] truncate text-sm text-foreground/90">{item.product.title}</span>
                      <span className="text-xs text-muted-foreground">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="text-right">
                  <p className="font-mono text-base font-medium tabular-nums">{formatKes(order.totalCents)}</p>
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
