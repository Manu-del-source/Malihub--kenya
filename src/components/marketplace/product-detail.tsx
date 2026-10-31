import Link from "next/link";
import { MapPin, Package, ShieldCheck, Truck, ChevronDown } from "lucide-react";
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
import { formatKes } from "@/utils";
import type { ProductWithRelations } from "@/types";

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
  const shareWhatsapp = product.contactPreference === "WHATSAPP" || product.contactPreference === "ANY";
  const [isFavorited, similar, sellerProfile] = await Promise.all([
    user
      ? prisma.wishlist
          .findUnique({ where: { userId_productId: { userId: user.id, productId: product.id } } })
          .then((w: unknown) => !!w)
      : Promise.resolve(false),
    getSimilarListings(product.id, product.category.id, product.county),
    shareWhatsapp
      ? prisma.profile.findUnique({ where: { userId: product.ownerId }, select: { whatsapp: true } })
      : Promise.resolve(null),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihubke.online";
  const canonicalUrl = `${appUrl}${canonicalPath}`;
  const isOwnListing = user?.id === product.ownerId;
  const isSold = product.status === "SOLD";
  const availableDetails = [
    product.brand ? ["Brand", product.brand] : null,
    product.size ? ["Size", product.size] : null,
    product.availableSizes ? ["Available sizes", product.availableSizes] : null,
    product.condition ? ["Condition", CONDITION_LABEL[product.condition] ?? product.condition] : null,
    product.county ? ["Location", product.subCounty ? `${product.subCounty}, ${product.county}` : product.county] : null,
  ].filter((item): item is string[] => item !== null);

  return (
    <>
      <ViewTracker productId={product.id} />
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
        <Link href="/marketplace" className="transition-colors hover:text-primary">Marketplace</Link>
        <span aria-hidden>/</span>
        <Link href={`/categories/${product.category.slug}`} className="transition-colors hover:text-primary">{product.category.name}</Link>
        <span aria-hidden>/</span>
        <span className="max-w-[min(55vw,24rem)] truncate font-medium text-foreground" aria-current="page">{product.title}</span>
      </nav>

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-7">
        <section className="min-w-0 rounded-2xl border border-border/80 bg-card p-2.5 shadow-sm sm:p-4">
          <ListingGallery images={product.images.map(({ url }) => ({ url }))} title={product.title} />
        </section>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {isSold && <Badge variant="primary">Sold</Badge>}
                <Badge>{CONDITION_LABEL[product.condition] ?? product.condition}</Badge>
                {product.quantity > 1 && !isSold && <Badge>{product.quantity} available</Badge>}
              </div>
              <FavoriteButton productId={product.id} initialFavorited={isFavorited} size="lg" />
            </div>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{product.category.name}</p>
            <h1 className="mt-1 break-words font-display text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
              {product.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-baseline gap-2">
              <p className="font-mono text-2xl font-bold tracking-tight tabular-nums text-primary sm:text-3xl">{formatKes(product.priceCents)}</p>
              {product.isNegotiable && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Negotiable</span>}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-y border-border py-3 text-xs text-muted-foreground sm:text-sm">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-primary" aria-hidden />{product.subCounty ? `${product.subCounty}, ` : ""}{product.county}</span>
              <span className="inline-flex items-center gap-1.5"><Package className="h-4 w-4 text-primary" aria-hidden />{isSold ? "Sold out" : `${product.quantity} available`}</span>
            </div>

            {availableDetails.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:text-sm">
                {availableDetails.slice(0, 4).map(([label, value]) => (
                  <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="truncate font-medium text-foreground">{value}</dd></div>
                ))}
              </dl>
            )}

            <div className="mt-4">
              {!isOwnListing ? (
                <AddToCartButton productId={product.id} status={product.status} stock={product.quantity} isLoggedIn={!!user} redirectTo={canonicalPath} />
              ) : (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">This is your listing.</p>
              )}
              {isSold && <p className="mt-2 text-xs text-muted-foreground">This item is marked as sold and cannot be purchased.</p>}
            </div>
          </section>

          <SellerInfoCard seller={product.seller} contactPreference={product.contactPreference} whatsapp={sellerProfile?.whatsapp} isOwnListing={isOwnListing} />

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Shop thoughtfully</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Review the item and seller details before paying. Confirm delivery arrangements before completing your purchase.</p>
          </div>
        </div>
      </div>

      <section className="mt-5 space-y-2">
        <details className="group rounded-xl border border-border bg-card px-4 py-3" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
            Product description <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="whitespace-pre-line pt-3 text-sm leading-6 text-muted-foreground">{product.description}</p>
        </details>
        <details className="group rounded-xl border border-border bg-card px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
            More product details <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-wrap gap-2 pt-3">
            <Badge>{product.category.name}</Badge>
            {product.brand && <Badge>{product.brand}</Badge>}
            {product.size && <Badge>Size: {product.size}{product.sizeSystem ? ` (${product.sizeSystem === "CLOTHING" ? "Clothing" : product.sizeSystem})` : ""}</Badge>}
            {product.availableSizes && <Badge>Available sizes: {product.availableSizes}</Badge>}
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2">
          <ShareButtons title={product.title} url={canonicalUrl} />
          <ReportListingDialog productId={product.id} />
        </div>
      </section>

      <SimilarListings listings={similar} />
    </>
  );
}
