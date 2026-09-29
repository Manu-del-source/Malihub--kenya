import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Flag, ExternalLink } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { AdminListingModerationPanel } from "@/components/shell/admin/admin-listing-moderation-panel";
import { SellerVerificationBadge, UserRoleBadge } from "@/components/shell/admin/admin-badges";
import { ListingStatusBadge } from "@/components/shell/seller/listing-status-badge";
import { formatDateTime } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { getAdminListingDetail } from "@/services/admin-service";
import { formatKes } from "@/utils";
import { PRODUCT_CONDITIONS } from "@/lib/constants";
import type { ProductCondition } from "@prisma/client";

/**
 * `/admin/listings/[id]` — the full moderation view of one listing: images,
 * price, location, status history stamps, the seller it belongs to, open
 * reports against it, and the moderation panel writing decisions through the
 * existing `ListingStatus` states.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Listing — admin" };

const CONDITION_LABEL = new Map<ProductCondition, string>(
  PRODUCT_CONDITIONS.map((c) => [c.value as ProductCondition, c.label])
);

export default async function AdminListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdministrator();

  const { id } = await params;
  const detail = await getAdminListingDetail(id);
  if (!detail) notFound();

  const { product, openReports } = detail;

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <Link href="/admin/listings" className="hover:text-foreground hover:underline">
          ← Listings
        </Link>
        {(product.status === "ACTIVE" || product.status === "SOLD") && (
          <Link
            href={`/products/${product.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs hover:text-foreground hover:underline"
          >
            View public page
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-medium">{product.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{formatKes(product.priceCents)}</span>
            {product.isNegotiable && <span className="ml-2 text-xs">(negotiable)</span>}
            <span className="mx-2" aria-hidden>
              ·
            </span>
            {CONDITION_LABEL.get(product.condition) ?? product.condition}
            {product.brand ? ` · ${product.brand}` : ""}
            <span className="mx-2" aria-hidden>
              ·
            </span>
            {product.county}
            {product.subCounty ? `, ${product.subCounty}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {openReports > 0 && (
            <Badge variant="default" className="bg-destructive/15 text-destructive">
              <Flag className="h-3 w-3" aria-hidden />
              {openReports} open report{openReports === 1 ? "" : "s"}
            </Badge>
          )}
          <ListingStatusBadge status={product.status} />
          {product.isFeatured && <Badge variant="primary">Featured</Badge>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          {/* ── Images ─────────────────────────────────────────────────── */}
          <section aria-label="Listing images" className="glass rounded-2xl p-4">
            {product.images.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                This listing has no images.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {product.images.map((image, index) => (
                  <li
                    key={image.id}
                    className={index === 0 ? "col-span-2 row-span-2 sm:col-span-2" : undefined}
                  >
                    <span className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                      <Image
                        src={image.url}
                        alt={index === 0 ? `${product.title} — primary image` : `${product.title} — image ${index + 1}`}
                        fill
                        sizes="(max-width: 640px) 50vw, 33vw"
                        className="object-cover"
                      />
                      {image.isPrimary && (
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                          Primary
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Description & attributes ───────────────────────────────── */}
          <section aria-label="Listing content" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Description</h2>
            <p className="mt-3 whitespace-pre-line text-sm text-foreground/90">{product.description}</p>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <AdminField label="Category" value={product.category.name} />
              <AdminField label="Quantity" value={product.quantity.toLocaleString()} />
              <AdminField
                label="Condition"
                value={CONDITION_LABEL.get(product.condition) ?? product.condition}
              />
              <AdminField label="Contact via" value={product.contactPreference.replace("_", " ").toLowerCase()} />
              <AdminField label="Created" value={formatDateTime(product.createdAt)} mono />
              <AdminField label="Updated" value={formatDateTime(product.updatedAt)} mono />
              <AdminField
                label="Published"
                value={product.publishedAt ? formatDateTime(product.publishedAt) : "never"}
                mono
              />
              <AdminField label="Slug" value={product.slug} mono />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              {product.viewCount.toLocaleString()} views · {product.favoriteCount.toLocaleString()}{" "}
              saves · {product._count.reviews} reviews · {product._count.orderItems} sold line
              item{product._count.orderItems === 1 ? "" : "s"} · {product._count.wishlists} wishlist
              entr{product._count.wishlists === 1 ? "y" : "ies"}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <AdminListingModerationPanel
            productId={product.id}
            status={product.status}
            title={product.title}
          />

          <section aria-label="Seller" className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-medium">Seller</h2>
              <SellerVerificationBadge status={product.seller.verificationStatus} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <AdminField label="Business" value={product.seller.businessName} />
              <AdminField
                label="Rating"
                value={`${product.seller.ratingAverage.toFixed(2)} ★ (${product.seller.ratingCount})`}
              />
              <AdminField label="County" value={product.seller.county} />
              <AdminField label="Storefront" value={`/${product.seller.slug}`} mono />
            </dl>
            <Link
              href={`/admin/sellers/${product.seller.id}`}
              className="mt-4 inline-flex items-center rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary-400 transition-colors hover:bg-primary/20"
            >
              Open seller review →
            </Link>
          </section>

          <section aria-label="Owner" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Listing owner</h2>
            <p className="mt-2 truncate text-sm">{product.owner.profile?.fullName ?? "Unnamed"}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{product.owner.email}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <UserRoleBadge role={product.owner.role} />
              <Link
                href={`/admin/users/${product.owner.id}`}
                className="text-xs text-primary-400 underline-offset-4 hover:underline"
              >
                User record →
              </Link>
            </div>
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
