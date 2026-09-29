import Link from "next/link";
import type { Metadata } from "next";
import { Search, ShoppingCart } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { AdminPagination, adminListHref } from "@/components/shell/admin/admin-pagination";
import { OrderStatusBadge } from "@/components/shell/admin/admin-badges";
import { formatDate } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { listAdminOrders } from "@/services/admin-service";
import { formatKes } from "@/utils";
import {
  adminOrderListSchema,
  parseListParams,
  type RawSearchParams,
} from "@/lib/validations/admin";

/**
 * `/admin/orders` — order oversight, deliberately read-only.
 *
 * The order lifecycle (`PENDING → CONFIRMED → PAID → …`) is driven by the
 * checkout and payment boundaries (`src/services/order-service.ts`, the
 * FastAPI payment layer). That architecture does NOT define a safe
 * administrative transition — letting an admin flip statuses by hand would
 * bypass the stock guards and payment idempotency the checkout transaction
 * is built on — so there are no order mutations behind this screen, only
 * full-fidelity reads for support and reconciliation.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orders — admin" };

const STATUS_OPTIONS = [
  "PENDING",
  "CONFIRMED",
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdministrator();

  const parsed = parseListParams(adminOrderListSchema, await searchParams);
  const filters = parsed ?? { page: 1 };

  const { orders, total, pageSize } = await listAdminOrders(filters);
  const current = { q: filters.q ?? "", status: filters.status ?? "" };

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} order{total === 1 ? "" : "s"} matching the current filters ·
            read-only oversight
          </p>
        </div>
      </header>

      <form className="glass-sm flex flex-wrap items-end gap-3 rounded-2xl p-4" method="GET">
        <label className="text-sm">
          <span className="text-muted-foreground">Search</span>
          <Input
            type="search"
            name="q"
            defaultValue={current.q}
            maxLength={120}
            placeholder="Order number, buyer name or email"
            className="mt-1 w-72"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={current.status}
            className="mt-1 block h-11 w-44 rounded-xl border border-border bg-background/60 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden />
          Apply
        </Button>
        {(current.q || current.status) && (
          <Link
            href="/admin/orders"
            className="self-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      {orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={total === 0 ? "No orders match." : "Nothing on this page."}
          description={
            total === 0
              ? "Orders are created at checkout — every marketplace order lands here for oversight."
              : "Try the next page or clear the filters."
          }
        />
      ) : (
        <div className="glass flex flex-col divide-y divide-border rounded-2xl">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/admin/orders/${order.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  <span className="font-mono">{order.orderNumber}</span>
                  <span className="ml-2 font-normal text-muted-foreground">
                    {order.buyer.profile?.fullName ?? order.buyer.email} → {order.seller.businessName}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {order._count.items} item{order._count.items === 1 ? "" : "s"} · placed{" "}
                  {formatDate(order.createdAt)}
                  {order.deliveryCounty ? ` · delivers to ${order.deliveryCounty}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-sm tabular-nums">{formatKes(order.totalCents)}</span>
                <OrderStatusBadge status={order.status} />
              </span>
            </Link>
          ))}
        </div>
      )}

      <AdminPagination
        page={filters.page}
        pageSize={pageSize}
        total={total}
        label="orders"
        buildHref={(page) => adminListHref("/admin/orders", current, page)}
      />
    </Container>
  );
}
