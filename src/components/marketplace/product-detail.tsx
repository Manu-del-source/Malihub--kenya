import Link from "next/link";
import { MapPin, Calendar, Package, ShieldCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ListingGallery } from "@/components/marketplace/listing-gallery";
import { SellerInfoCard } from "@/components/marketplace/seller-info-card";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { ShareButtons } from "@/components/marketplace/share-buttons";
import { ReportListingDialog } from "@/components/marketplace/report-listing-dialog";
import { SimilarListings } from "@/components/marketplace/similar-listings";
import { ViewTracker } from "@/components/marketplace/view-tracker";
import { AddToCartButton } from "@/components/marketplace/add-to-cart-button";
import { getSimilarListings } from "@/services/search-service";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatKes, timeAgo } from "@/utils";
import type { ProductWithRelations } from "@/types";

/**
 * Shared product detail for both /products/[slug] and /marketplace/[productId].
 * Keep all listing actions and seller contact behavior in this component.
 */
const CONDITION_LABEL: Record<string, string> = {
  NEW: "Brand New",
  LIKE_NEW: "Like New",
  GOOD: "Good",
  FAIR: "Fair",
};

export async function ProductDetail({
  product,
  canonicalPath,
}: {
  product: ProductWithRelations & { status: string; ownerId: string };
  canonicalPath: string;
}) {
  const user = (await getCurrentUser())?.user;

  const [isFavorited, sellerContact, similar, sellerProfile] = await Promise.all([
    user
      ? prisma.wishlist
          .findUnique({ where: { userId_productId: { userId: user.id, productId: product.id } } })
          .then((w: unknown) => !!w)
      : Promise.resolve(false),
    prisma.user.findUnique({ where: { id: product.ownerId }, select: { phone: true } }),
    getSimilarListings(product.id, product.categoryId, product.county),
    prisma.profile.findUnique({ where: { userId: product.ownerId }, select: { whatsapp: true } }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihub.co.ke";
  const canonicalUrl = `${appUrl}${canonicalPath}`;
  const isOwnListing = user?.id === product.ownerId;
  const isSold = product.status === "SOLD";

  return (
    <>
      <ViewTracker productId={product.id} />

      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href="/marketplace" className="transition-colors hover:text-primary">
          Marketplace
        </Link>
        <span aria-hidden className="text-border">/</span>
        <Link href={`/categories/${product.category.slug}`} className="transition-colors hover:text-primary">
          {product.category.name}
        </Link>
        <span aria-hidden className="text-border">/</span>
        <span className="max-w-[min(60vw,28rem)] truncate font-medium text-foreground" aria-current="page">
          {product.title}
        </span>
      </nav>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-border/80 bg-card p-3 shadow-sm sm:p-4">
            <ListingGallery images={product.images} title={product.title} />
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {isSold && <Badge variant="primary">Sold</Badge>}
                  <Badge>{CONDITION_LABEL[product.condition] ?? product.condition}</Badge>
                  {product.quantity > 1 && !isSold && <Badge>{product.quantity} available</Badge>}
                </div>
                <h1 className="break-words font-display text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
                  {product.title}
                </h1>
                <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-mono text-3xl font-bold tracking-tight tabular-nums text-primary sm:text-4xl">
                    {formatKes(product.priceCents)}
                  </p>
                  {product.isNegotiable && (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      Price negotiable
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 rounded-xl border border-border bg-background p-1">
                <FavoriteButton productId={product.id} initialFavorited={isFavorited} size="lg" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-3 border-y border-border py-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                {product.subCounty ? `${product.subCounty}, ` : ""}{product.county}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                Posted {timeAgo(product.publishedAt ?? product.createdAt)}
              </span>
              {product.brand && (
                <span className="inline-flex items-center gap-1.5">
                  <Package className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {product.brand}
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge>{product.category.name}</Badge>
              {product.brand && <Badge>{product.brand}</Badge>}
            </div>

            <div className="mt-7">
              <h2 className="font-display text-lg font-semibold">Product description</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-foreground/85">
                {product.description}
              </p>
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <ShareButtons title={product.title} url={canonicalUrl} />
              <ReportListingDialog productId={product.id} />
            </div>
          </section>

          <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold">Shop thoughtfully</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Check the item and seller details before paying. For in-person exchanges, meet in a public place.
              </p>
            </div>
          </div>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Truck className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Ready to make it yours?</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Review the listing, then contact the seller or add it to your cart.
                </p>
              </div>
            </div>
            {!isOwnListing && (
              <AddToCartButton
                productId={product.id}
                status={product.status}
                stock={product.quantity}
                isLoggedIn={!!user}
                redirectTo={canonicalPath}
              />
            )}
            {isOwnListing && (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                This is your listing.
              </p>
            )}
            {isSold && (
              <p className="mt-3 text-xs text-muted-foreground">
                This item is marked as sold and cannot be purchased.
              </p>
            )}
          </section>

          <SellerInfoCard
            seller={product.seller}
            sellerUserId={product.ownerId}
            productId={product.id}
            contactPreference={product.contactPreference}
            whatsapp={sellerProfile?.whatsapp}
            phone={sellerContact?.phone}
            isOwnListing={isOwnListing}
          />
        </aside>
      </div>

      <SimilarListings listings={similar} />
    </>
  );
}
