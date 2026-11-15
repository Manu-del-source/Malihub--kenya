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
import { dispatchSlaHours, isDispatchOverdue } from "@/lib/order-sla";
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
 * The order lifecycle (`PENDING → PAID → SHIPPED → DELIVERED → COMPLETED`, plus
 * `PENDING → CANCELLED`) is driven by the
 * checkout and payment boundaries (`src/services/order-service.ts`, the
 * FastAPI payment layer). That architecture does NOT define a safe
 * administrative transition — letting an admin flip statuses by hand would
 * bypass the stock guards and payment idempotency the checkout transaction
 * is built on — so there are no order mutations behind this screen, only
 * full-fidelity reads for support and reconciliation.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orders — admin" };

const FILTER_CHIPS = [
  { label: "All", params: {} },
  { label: "Pending payment", params: { status: "PENDING" } },
  { label: "Paid · awaiting dispatch", params: { status: "PAID" } },
  { label: "Overdue dispatch", params: { overdue: "1" } },
  { label: "Shipped", params: { status: "SHIPPED" } },
  { label: "Delivered", params: { status: "DELIVERED" } },
  { label: "Completed", params: { status: "COMPLETED" } },
  { label: "Cancelled", params: { status: "CANCELLED" } },
  { label: "Refunded", params: { status: "REFUNDED" } },
] as const;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdministrator();

  const parsed = parseListParams(adminOrderListSchema, await searchParams);
  const filters = parsed;

  const { orders, total, pageSize } = await listAdminOrders(filters);
  const current = { q: filters.q ?? "", status: filters.status ?? "", overdue: filters.overdue ?? "" };
  const now = new Date();
  const slaHours = dispatchSlaHours();

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} order{total === 1 ? "" : "s"} matching the current filters ·
            payment and fulfilment oversight (overrides are on each order&apos;s page)
          </p>
        </div>
      </header>

      <nav aria-label="Order status filter" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {FILTER_CHIPS.map((chip) => {
          const p = chip.params as { status?: string; overdue?: string };
          const active = (p.status ?? "") === current.status && (p.overdue ?? "") === current.overdue;
          const qs = new URLSearchParams({ ...(current.q ? { q: current.q } : {}), ...p }).toString();
          return (
            <Link
              key={chip.label}
              href={qs ? `/admin/orders?${qs}` : "/admin/orders"}
              aria-current={active ? "page" : undefined}
              className={[
                "shrink-0 whitespace-nowrap rounded-full border border-border px-3.5 py-2 text-sm font-medium",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {chip.label}
            </Link>
          );
        })}
      </nav>
      {current.overdue && (
        <p className="text-xs text-muted-foreground">
          Overdue = paid more than {slaHours} hours ago and still not shipped (monitoring threshold; set
          ORDER_DISPATCH_SLA_HOURS to the approved rule).
        </p>
      )}

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
        {current.status && <input type="hidden" name="status" value={current.status} />}
        {current.overdue && <input type="hidden" name="overdue" value={current.overdue} />}
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden />
          Apply
        </Button>
        {(current.q || current.status || current.overdue) && (
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
                  {order.items.map((i) => `${i.quantity}× ${i.product.title}`).join(", ")}
                  {order._count.items > order.items.length ? ` +${order._count.items - order.items.length} more` : ""}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Placed {formatDate(order.createdAt)}
                  {order.payments[0]
                    ? ` · ${order.payments[0].provider} ${order.payments[0].status.toLowerCase()}${
                        order.payments[0].providerTransactionId ? ` (${order.payments[0].providerTransactionId})` : ""
                      }${order.payments[0].paidAt ? `, paid ${formatDate(order.payments[0].paidAt)}` : ""}`
                    : " · no payment recorded"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {order.shipment
                    ? `${order.shipment.carrierName} · ${order.shipment.trackingNumber}${
                        order.shipment.dispatchedAt ? ` · dispatched ${formatDate(order.shipment.dispatchedAt)}` : ""
                      }`
                    : "No tracking yet"}
                  {order.deliveredAt ? ` · delivered ${formatDate(order.deliveredAt)}` : ""}
                  {order.status === "COMPLETED" ? " · buyer confirmed receipt" : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-sm tabular-nums">{formatKes(order.totalCents)}</span>
                <OrderStatusBadge status={order.status} />
                {isDispatchOverdue(order.status, order.payments[0]?.paidAt, now, slaHours) && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">Overdue</span>
                )}
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
