import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, Star } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import {
  AccountStatusBadge,
  OrderStatusBadge,
  SellerVerificationBadge,
  UserRoleBadge,
} from "@/components/shell/admin/admin-badges";
import { AdminSellerReviewPanel } from "@/components/shell/admin/admin-seller-review-panel";
import { ListingStatusBadge } from "@/components/shell/seller/listing-status-badge";
import { formatDateTime } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { getAdminSellerDetail } from "@/services/admin-service";
import { formatKes } from "@/utils";

/**
 * `/admin/sellers/[id]` — one seller for review: business record, owner,
 * catalogue, sales, and (for admins only, gated by the action guard again)
 * the verify/reject decision on the existing `verificationStatus` column.
 * The target is a database lookup on a validated UUID — changing the id in
 * the URL changes WHICH seller is viewed, never WHO is allowed to view.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Seller — admin" };

export default async function AdminSellerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdministrator();

  const { id } = await params;
  const detail = await getAdminSellerDetail(id);
  if (!detail) notFound();

  const { seller, listings, sales, recentListings, recentOrders } = detail;
  const owner = seller.user;

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="text-sm text-muted-foreground">
        <Link href="/admin/sellers" className="hover:text-foreground hover:underline">
          ← Sellers
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {seller.logoUrl ? (
            <span className="relative block h-14 w-14 overflow-hidden rounded-xl border border-border bg-card">
              <Image src={seller.logoUrl} alt="" fill sizes="56px" className="object-cover" />
            </span>
          ) : (
            <span
              aria-hidden
              className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-xl font-semibold text-primary-400"
            >
              {seller.businessName.charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="font-display text-2xl font-medium">{seller.businessName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="font-mono">/{seller.slug}</span>
              {seller.county ? ` · ${seller.county}` : ""}
              {seller.subCounty ? `, ${seller.subCounty}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SellerVerificationBadge status={seller.verificationStatus} />
          {seller.ratingCount > 0 && (
            <Badge variant="primary">
              <Star className="h-3 w-3" aria-hidden />
              {seller.ratingAverage.toFixed(1)} ({seller.ratingCount})
            </Badge>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <section aria-label="Business information" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Business</h2>
            {seller.description ? (
              <p className="mt-3 whitespace-pre-line text-sm text-foreground/90">{seller.description}</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No business description provided.</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <AdminField label="KRA PIN" value={seller.kraPin ?? "—"} mono />
              <AdminField label="Total sales (lifetime)" value={seller.totalSales.toLocaleString()} />
              <AdminField
                label="Response rate"
                value={seller.responseRatePct === null ? "—" : `${seller.responseRatePct}%`}
              />
              <AdminField label="Registered" value={formatDateTime(seller.createdAt)} mono />
              <AdminField label="Last updated" value={formatDateTime(seller.updatedAt)} mono />
            </dl>
            {seller.idDocumentUrl && (
              <p className="mt-4 flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                <a
                  href={seller.idDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-primary-400 underline-offset-4 hover:underline"
                >
                  Uploaded ID document
                </a>
                <span className="text-xs text-muted-foreground">
                  (stored on the media provider; opened directly)
                </span>
              </p>
            )}
          </section>

          <section aria-label="Catalogue" className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-medium">Listings</h2>
              <Link href={`/admin/listings?seller=${encodeURIComponent(seller.businessName)}`} className="text-sm text-primary-400 hover:underline">
                Filter listings by this seller →
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <MiniStat label="Active" value={listings.active} />
              <MiniStat label="Pending review" value={listings.pendingReview} />
              <MiniStat label="Drafts" value={listings.drafts} />
              <MiniStat label="Sold" value={listings.sold} />
              <MiniStat label="Suspended" value={listings.suspended} />
              <MiniStat label="All" value={listings.total} />
            </div>
            {recentListings.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">This seller has not listed anything yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
                {recentListings.map((listing) => (
                  <li key={listing.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/admin/listings/${listing.id}`} className="min-w-0 truncate text-sm hover:underline">
                      {listing.title}
                      <span className="ml-2 text-xs text-muted-foreground">{listing.category.name}</span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-sm tabular-nums">{formatKes(listing.priceCents)}</span>
                      <ListingStatusBadge status={listing.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Sales" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Orders & sales</h2>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <MiniStat label="Orders received" value={sales.totalOrders} />
              <MiniStat label="Paid-status orders" value={sales.paidOrders} />
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Paid order value</p>
                <p className="mt-1 font-mono text-lg tabular-nums">{formatKes(sales.paidRevenueCents)}</p>
              </div>
            </div>
            {recentOrders.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No orders yet for this seller.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
                {recentOrders.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <Link href={`/admin/orders/${order.id}`} className="min-w-0 truncate hover:underline">
                      <span className="font-mono">{order.orderNumber}</span>{" "}
                      <span className="text-muted-foreground">
                        {order.buyer.profile?.fullName ?? "a buyer"} · {order._count.items} item
                        {order._count.items === 1 ? "" : "s"}
                      </span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono tabular-nums">{formatKes(order.totalCents)}</span>
                      <OrderStatusBadge status={order.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <AdminSellerReviewPanel
            sellerId={seller.id}
            status={seller.verificationStatus}
            businessName={seller.businessName}
          />

          <section aria-label="Owner" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Owner account</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <UserRoleBadge role={owner.role} />
              <AccountStatusBadge isActive={owner.isActive} isBanned={owner.isBanned} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <AdminField label="Name" value={owner.profile?.fullName ?? "—"} />
              <AdminField label="Email" value={owner.email} mono />
              <AdminField label="Joined" value={formatDateTime(owner.createdAt)} mono />
            </dl>
            <Link
              href={`/admin/users/${owner.id}`}
              className="mt-4 inline-flex items-center rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary-400 transition-colors hover:bg-primary/20"
            >
              Open user record →
            </Link>
          </section>

        </div>
      </div>

    </Container>
  );
}

function AdminField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 truncate font-mono text-sm" : "mt-0.5 truncate text-sm"}>{value}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
