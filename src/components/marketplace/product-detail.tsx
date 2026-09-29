import Link from "next/link";
import { MapPin, Calendar, Package } from "lucide-react";
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
 * The full product-detail view, shared by `/products/[slug]` and the
 * canonical `/marketplace/[productId]` so there is exactly ONE detail page
 * implementation. Both routes resolve the listing themselves (by slug / by
 * id), check visibility, and hand the row here; everything else — gallery,
 * favourite, cart, seller card, similar listings, view tracking — lives in
 * this one component.
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
  /** The URL this view was reached at, used for sharing (slug vs id form). */
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

  return (
    <>
      <ViewTracker productId={product.id} />

      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/marketplace" className="hover:text-foreground">
          Marketplace
        </Link>
        {" / "}
        <Link href={`/categories/${product.category.slug}`} className="hover:text-foreground">
          {product.category.name}
        </Link>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
        <div>
          <ListingGallery images={product.images} title={product.title} />

          <div className="mt-6 flex items-start justify-between gap-4">
            <div>
              {product.status === "SOLD" && (
                <Badge variant="primary" className="mb-2">
                  Sold
                </Badge>
              )}
              <h1 className="font-display text-2xl font-medium sm:text-3xl">{product.title}</h1>
              <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-primary-400">
                {formatKes(product.priceCents)}
                {product.isNegotiable && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    negotiable
                  </span>
                )}
              </p>
            </div>
            <FavoriteButton productId={product.id} initialFavorited={isFavorited} size="lg" />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden />
              {product.subCounty ? `${product.subCounty}, ` : ""}
              {product.county}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4" aria-hidden />
              Posted {timeAgo(product.publishedAt ?? product.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Package className="h-4 w-4" aria-hidden />
              {CONDITION_LABEL[product.condition]}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Badge>{product.category.name}</Badge>
            {product.brand && <Badge>{product.brand}</Badge>}
            {product.quantity > 1 && <Badge>{product.quantity} available</Badge>}
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <h2 className="mb-3 font-display text-lg font-medium">Description</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {product.description}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
            <ShareButtons title={product.title} url={canonicalUrl} />
            <ReportListingDialog productId={product.id} />
          </div>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          {!isOwnListing && (
            <div className="mb-4">
              <AddToCartButton
                productId={product.id}
                status={product.status}
                stock={product.quantity}
                isLoggedIn={!!user}
                redirectTo={canonicalPath}
              />
            </div>
          )}
          <SellerInfoCard
            seller={product.seller}
            sellerUserId={product.ownerId}
            productId={product.id}
            contactPreference={product.contactPreference}
            whatsapp={sellerProfile?.whatsapp}
            phone={sellerContact?.phone}
            isOwnListing={isOwnListing}
          />
        </div>
      </div>

      <SimilarListings listings={similar} />
    </>
  );
}
