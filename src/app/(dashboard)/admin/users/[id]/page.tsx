import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Mail, Package, ShieldQuestion } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ListingStatusBadge } from "@/components/shell/seller/listing-status-badge";
import {
  AccountStatusBadge,
  OrderStatusBadge,
  SellerVerificationBadge,
  UserRoleBadge,
} from "@/components/shell/admin/admin-badges";
import { formatDate, formatDateTime } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { getAdminUserDetail } from "@/services/admin-service";
import { formatKes } from "@/utils";

/**
 * `/admin/users/[id]` — one account, administration view.
 *
 * What this page CANNOT show is structural, not a UI choice: MaliHub's
 * database holds no passwords, session tokens, or auth secrets at all (Neon
 * Auth owns credentials), the provider mapping column (`auth_user_id`) is
 * selected out of the query, and free-text contact fields are the only PII
 * surfaced. The id comes from the URL but is validated as a UUID and looked
 * up exactly — no client-supplied role or filter can widen what loads.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "User — admin" };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdministrator();

  const { id } = await params;
  const detail = await getAdminUserDetail(id);
  if (!detail) notFound();

  const { user, recentOrdersAsBuyer, recentListings, ordersAsSeller, openOrdersAsBuyer } = detail;

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/users" className="hover:text-foreground hover:underline">
          ← Users
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary-400"
          >
            {(user.profile?.fullName ?? user.email).charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="font-display text-2xl font-medium">
              {user.profile?.fullName ?? "Unnamed account"}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {user.email}
                          </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UserRoleBadge role={user.role} />
          <AccountStatusBadge isActive={user.isActive} isBanned={user.isBanned} />
          {user.emailVerified ? (
            <Badge variant="cyan">
              <BadgeCheck className="h-3 w-3" aria-hidden />
              Email verified
            </Badge>
          ) : (
            <Badge variant="default">Email unverified</Badge>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        {/* ── Account & profile ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <section aria-label="Account details" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Account</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label="Joined" value={formatDateTime(user.createdAt)} mono />
              <Field label="Last seen" value={user.lastSeenAt ? formatDateTime(user.lastSeenAt) : "—"} mono />
              <Field
                label="Profile completed"
                value={user.profile?.onboarded ? "Yes" : "Not finished"}
              />
              <Field label="Profile created" value={user.profile ? formatDate(user.profile.createdAt) : "—"} />
              <Field
                label="Location"
                value={
                  user.profile?.county
                    ? [user.profile.subCounty, user.profile.county].filter(Boolean).join(", ")
                    : "—"
                }
              />
              <Field
                label="Marketplace activity"
                value={`${user._count.products} listings · ${user._count.orders} orders as buyer`}
              />
              <Field label="Wishlist entries" value={String(user._count.wishlists)} />
              <Field label="Reviews written" value={String(user._count.reviews)} />
            </dl>
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              No credentials live in this database — passwords and session tokens are held by the
              auth provider, so they cannot appear here either.
            </p>
          </section>

          {user.seller && (
            <section aria-label="Seller profile" className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-medium">Seller profile</h2>
                <SellerVerificationBadge status={user.seller.verificationStatus} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="Business" value={user.seller.businessName} />
                <Field label="Slug" value={user.seller.slug} mono />
                <Field
                  label="Rating"
                  value={`${user.seller.ratingAverage.toFixed(2)} ★ (${user.seller.ratingCount})`}
                />
                <Field label="Total sales" value={user.seller.totalSales.toLocaleString()} />
              </dl>
              <div className="mt-4 flex gap-2">
                <ButtonLink href={`/admin/sellers/${user.seller.id}`}>Open seller review →</ButtonLink>
                {ordersAsSeller > 0 && (
                  <span className="self-center text-xs text-muted-foreground">
                    {ordersAsSeller} order{ordersAsSeller === 1 ? "" : "s"} received as this seller
                  </span>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ── Marketplace activity ──────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <section aria-label="Orders as buyer" className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-medium">Orders as buyer</h2>
              <span className="text-xs text-muted-foreground">{openOrdersAsBuyer} still open</span>
            </div>
            {recentOrdersAsBuyer.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No orders placed from this account yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {recentOrdersAsBuyer.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="min-w-0 truncate text-sm hover:underline"
                    >
                      <span className="font-mono">{order.orderNumber}</span>{" "}
                      <span className="text-muted-foreground">→ {order.seller.businessName}</span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-sm tabular-nums">{formatKes(order.totalCents)}</span>
                      <OrderStatusBadge status={order.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Listings" className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-medium">Listings owned</h2>
              <span className="text-xs text-muted-foreground">{user._count.products} total</span>
            </div>
            {recentListings.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Nothing listed."
                description="Listings created by this account (as seller or buyer) will appear here."
              />
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {recentListings.map((listing) => (
                  <li key={listing.id}>
                    <Link
                      href={`/admin/listings/${listing.id}`}
                      className="flex flex-col gap-1 rounded-xl border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm">{listing.title}</span>
                        <ListingStatusBadge status={listing.status} />
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatKes(listing.priceCents)} · {formatDate(listing.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Container>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 truncate font-mono text-sm" : "mt-0.5 truncate text-sm"}>{value}</dd>
    </div>
  );
}

function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary-400 transition-colors hover:bg-primary/20"
    >
      {children}
    </Link>
  );
}
