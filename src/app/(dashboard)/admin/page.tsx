import Link from "next/link";
import type { Metadata } from "next";
import {
  BadgeCheck,
  Clock,
  Heart,
  Package,
  ScrollText,
  ShoppingCart,
  Store,
  Tags,
  Users,
  XCircle,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { AdminStatCard } from "@/components/shell/admin/admin-stat-card";
import { ListingStatusBadge } from "@/components/shell/seller/listing-status-badge";
import { OrderStatusBadge } from "@/components/shell/admin/admin-badges";
import { formatDateTime } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { getAdminOverview } from "@/services/admin-service";
import { formatKes, timeAgo } from "@/utils";

/**
 * `/admin` — the operational overview of the marketplace.
 *
 * Every number is a live aggregate from Postgres (see `getAdminOverview` in
 * `src/services/admin-service.ts`); when the database holds nothing yet,
 * tiles show a truthful 0 and recent panels show empty states. Nothing here
 * is mocked, rounded up, or "sample" data, and each tile links to the admin
 * list pre-filtered to exactly what it counts.
 *
 * The order-value metrics are labelled for what they are: sums over
 * `orders.total_cents`. MaliHub's payment provider integration is not live
 * yet, so no number on this page claims to be settled money.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin overview" };

export default async function AdminDashboardPage() {
  // The gate for the whole /admin subtree also lives in the layout; pages
  // call it themselves as defense in depth — React.cache collapses this to
  // the same one session + one authorization read per request.
  await requireAdministrator();

  const data = await getAdminOverview();

  return (
    <Container className="flex flex-col gap-10 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-medium">Marketplace overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live counts from the production database — updated on every request.
          </p>
        </div>
        <Link href="/admin/audit" className="text-sm text-primary-400 hover:underline">
          Recent admin activity →
        </Link>
      </header>

      {/* ── Accounts ─────────────────────────────────────────────────────── */}
      <section aria-label="Accounts">
        <h2 className="mb-3 font-display text-lg font-medium">Accounts</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <AdminStatCard label="Total users" value={data.users.total.toLocaleString()} icon={Users} href="/admin/users" />
          <AdminStatCard label="Buyer-role accounts" value={data.users.buyers.toLocaleString()} icon={Heart} href="/admin/users?role=BUYER" />
          <AdminStatCard label="Seller-role accounts" value={data.users.sellers.toLocaleString()} icon={Store} href="/admin/users?role=SELLER" />
          <AdminStatCard label="Staff accounts" value={data.users.staff.toLocaleString()} icon={BadgeCheck} href="/admin/users?role=ADMIN" />
          <AdminStatCard
            label="Banned accounts"
            value={data.users.banned.toLocaleString()}
            icon={XCircle}
            tone={data.users.banned > 0 ? "attention" : "default"}
            href="/admin/users?account=banned"
          />
        </div>
      </section>

      {/* ── Seller verification ──────────────────────────────────────────── */}
      <section aria-label="Seller verification">
        <h2 className="mb-3 font-display text-lg font-medium">Sellers</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <AdminStatCard
            label="Pending verifications"
            value={data.sellers.pendingVerifications.toLocaleString()}
            icon={Clock}
            tone={data.sellers.pendingVerifications > 0 ? "attention" : "default"}
            href="/admin/sellers?verification=PENDING"
          />
          <AdminStatCard label="Verified sellers" value={data.sellers.verified.toLocaleString()} icon={BadgeCheck} tone="success" href="/admin/sellers?verification=VERIFIED" />
          <AdminStatCard label="Rejected sellers" value={data.sellers.rejected.toLocaleString()} icon={XCircle} href="/admin/sellers?verification=REJECTED" />
          <AdminStatCard label="Total seller profiles" value={data.sellers.total.toLocaleString()} icon={Store} href="/admin/sellers" />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Counted on the <span className="font-mono">sellers</span> table — what seller access keys
          off, independent of account role.
        </p>
      </section>

      {/* ── Listings ─────────────────────────────────────────────────────── */}
      <section aria-label="Listings">
        <h2 className="mb-3 font-display text-lg font-medium">Listings</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <AdminStatCard label="Total listings" value={data.listings.total.toLocaleString()} icon={Package} href="/admin/listings" />
          <AdminStatCard label="Active" value={data.listings.active.toLocaleString()} icon={Tags} tone="success" href="/admin/listings?status=ACTIVE" />
          <AdminStatCard
            label="Pending review"
            value={data.listings.pendingReview.toLocaleString()}
            icon={Clock}
            tone={data.listings.pendingReview > 0 ? "attention" : "default"}
            href="/admin/listings?status=PENDING_REVIEW"
          />
          <AdminStatCard label="Drafts" value={data.listings.drafts.toLocaleString()} icon={Package} href="/admin/listings?status=DRAFT" />
          <AdminStatCard label="Sold" value={data.listings.sold.toLocaleString()} icon={BadgeCheck} href="/admin/listings?status=SOLD" />
          <AdminStatCard
            label="Suspended"
            value={data.listings.suspended.toLocaleString()}
            icon={XCircle}
            tone={data.listings.suspended > 0 ? "attention" : "default"}
            href="/admin/listings?status=SUSPENDED"
          />
        </div>
      </section>

      {/* ── Orders ───────────────────────────────────────────────────────── */}
      <section aria-label="Orders">
        <h2 className="mb-3 font-display text-lg font-medium">Orders</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <AdminStatCard label="Total orders" value={data.orders.total.toLocaleString()} icon={ShoppingCart} href="/admin/orders" />
          <AdminStatCard label="Awaiting payment" value={data.orders.pending.toLocaleString()} icon={Clock} href="/admin/orders?status=PENDING" />
          <AdminStatCard label="Completed" value={data.orders.completed.toLocaleString()} icon={BadgeCheck} tone="success" href="/admin/orders?status=COMPLETED" />
          <AdminStatCard label="Cancelled" value={data.orders.cancelled.toLocaleString()} icon={XCircle} href="/admin/orders?status=CANCELLED" />
          <AdminStatCard
            label="Booked order value"
            value={formatKes(data.orders.bookedValueCents)}
            icon={Package}
            hint={`Across ${data.orders.total.toLocaleString()} orders, excluding cancelled/refunded. Payments are not collected by MaliHub yet.`}
          />
          <AdminStatCard
            label="Paid-status order value"
            value={formatKes(data.orders.paidValueCents)}
            icon={BadgeCheck}
            hint={`Sum over ${data.orders.paid.toLocaleString()} orders in paid statuses (PAID / SHIPPED / DELIVERED / COMPLETED).`}
          />
        </div>
      </section>

      {/* ── Recent activity ──────────────────────────────────────────────── */}
      <section aria-label="Recent activity" className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-medium">Newest accounts</h2>
            <Link href="/admin/users" className="text-sm text-primary-400 hover:underline">
              All users →
            </Link>
          </div>
          {data.recent.users.length === 0 ? (
            <EmptyState icon={Users} title="No accounts yet." description="New sign-ups will appear here as the marketplace grows." />
          ) : (
            <div className="glass flex flex-col divide-y divide-border rounded-2xl">
              {data.recent.users.map((user) => (
                <Link
                  key={user.id}
                  href={`/admin/users/${user.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.profile?.fullName ?? "Unnamed"}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={user.role === "BUYER" ? "default" : "primary"}>
                      {user.role === "SUPER_ADMIN" ? "Super admin" : user.role.charAt(0) + user.role.slice(1).toLowerCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{timeAgo(user.createdAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-medium">Newest listings</h2>
            <Link href="/admin/listings" className="text-sm text-primary-400 hover:underline">
              All listings →
            </Link>
          </div>
          {data.recent.listings.length === 0 ? (
            <EmptyState icon={Package} title="No listings yet." description="Products sellers create — including ones awaiting review — show up here." />
          ) : (
            <div className="glass flex flex-col divide-y divide-border rounded-2xl">
              {data.recent.listings.map((listing) => (
                <Link
                  key={listing.id}
                  href={`/admin/listings/${listing.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{listing.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{listing.seller.businessName}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm tabular-nums">{formatKes(listing.priceCents)}</span>
                    <ListingStatusBadge status={listing.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-medium">Recent orders</h2>
            <Link href="/admin/orders" className="text-sm text-primary-400 hover:underline">
              All orders →
            </Link>
          </div>
          {data.recent.orders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No orders yet." description="Checkout activity will appear here." />
          ) : (
            <div className="glass flex flex-col divide-y divide-border rounded-2xl">
              {data.recent.orders.map((order) => (
                <Link
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="font-mono">{order.orderNumber}</span>{" "}
                      <span className="text-muted-foreground">
                        {order.buyer.profile?.fullName ?? "a buyer"} → {order.seller.businessName}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">{timeAgo(order.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm tabular-nums">{formatKes(order.totalCents)}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-medium">Administrative & security activity</h2>
            <Link href="/admin/audit" className="text-sm text-primary-400 hover:underline">
              Full audit log →
            </Link>
          </div>
          {data.recent.auditEvents.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No audit events recorded."
              description="Sign-in failures and every privileged admin decision are appended to the audit trail."
            />
          ) : (
            <div className="glass flex flex-col divide-y divide-border rounded-2xl">
              {data.recent.auditEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{event.action}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {event.actorEmail ?? "anonymous"}
                      {event.targetType ? ` · ${event.targetType}${event.targetId ? ` ${event.targetId.slice(0, 8)}…` : ""}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(event.createdAt)}>
                    {timeAgo(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

    </Container>
  );
}
