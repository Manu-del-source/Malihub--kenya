import Link from "next/link";
import { ArrowRight, Flame, Sparkles } from "lucide-react";
import { Container } from "@/components/ui/container";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { searchListings } from "@/services/search-service";

function toListingCardData(product: Awaited<ReturnType<typeof searchListings>>["items"][number]): ListingCardData | null {
  const imageUrl = product.images[0]?.url;
  if (!imageUrl) return null;

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    priceCents: product.priceCents,
    isNegotiable: product.isNegotiable,
    imageUrl,
    county: product.county,
    isVerifiedSeller: product.seller.verificationStatus === "VERIFIED",
    sellerName: product.seller.businessName,
    favoriteCount: 0,
    condition: product.condition,
  };
}

export async function HomepageProductCollections() {
  const [newestResult, popularResult] = await Promise.all([
    searchListings({ sort: "newest" }, 8),
    searchListings({ sort: "most_viewed" }, 8),
  ]);

  const newest = newestResult.items
    .map(toListingCardData)
    .filter((listing): listing is ListingCardData => listing !== null);
  const newestIds = new Set(newest.map((listing) => listing.id));
  const popular = popularResult.items
    .map(toListingCardData)
    .filter((listing): listing is ListingCardData => listing !== null)
    .filter((listing) => !newestIds.has(listing.id));

  return (
    <section aria-labelledby="homepage-new-arrivals" className="py-16 sm:py-24">
      <Container className="flex flex-col gap-12 sm:gap-16">
        <div>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
                Fresh on MaliHub
              </p>
              <h2 id="homepage-new-arrivals" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Recently added
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Browse current listings from verified sellers, with prices and locations supplied by the marketplace.
              </p>
            </div>
            <Link href="/marketplace?sort=newest" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              View all <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          {newest.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {newest.slice(0, 8).map((listing) => <ListingCard key={listing.id} listing={listing} />)}
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              New listings will appear here as verified sellers publish products.
            </p>
          )}
        </div>

        {popular.length > 0 && (
          <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  <Flame className="h-4 w-4" aria-hidden />
                  Worth a look
                </p>
                <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  Most viewed
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Listings ranked by recorded views, not paid placement.
                </p>
              </div>
              <Link href="/marketplace?sort=most_viewed" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                Explore marketplace <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {popular.slice(0, 8).map((listing) => <ListingCard key={listing.id} listing={listing} />)}
            </div>
          </div>
        )}
      </Container>
    </section>
  );
}
