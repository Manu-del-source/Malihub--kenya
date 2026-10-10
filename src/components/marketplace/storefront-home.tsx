import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { CategoryTiles } from "@/components/marketplace/category-tiles";
import { ListingStrip } from "@/components/marketplace/listing-strip";
import { searchListings } from "@/services/search-service";
import { toListingCardData } from "@/lib/mappers";

const BANNERS = [
  {
    id: "sell",
    title: "Sell fast on MaliHub",
    subtitle: "List in 2 minutes. Get paid via M-Pesa.",
    cta: "Start selling",
    href: "/register?role=seller",
    className: "from-primary-600 to-secondary text-white",
  },
  {
    id: "phones",
    title: "Phones & Gadgets",
    subtitle: "Verified sellers across Kenya",
    cta: "Shop now",
    href: "/categories/phones",
    className: "from-secondary to-neutral-900 text-white",
  },
  {
    id: "home",
    title: "Home & Furniture",
    subtitle: "Brand new & like-new deals",
    cta: "Shop now",
    href: "/categories/furniture",
    className: "from-accent to-emerald-950 text-white",
  },
  {
    id: "vehicles",
    title: "Cars & Vehicles",
    subtitle: "Find your next ride near you",
    cta: "Browse",
    href: "/categories/vehicles",
    className: "from-primary-400 to-primary-700 text-primary-foreground",
  },
];

/**
 * The marketplace's "front door": promo banners, category shortcuts and
 * swipeable listing rows. Shown on /marketplace only when no search or filter
 * is active, so results pages stay focused.
 */
export async function StorefrontHome() {
  const [newest, popular] = await Promise.all([
    searchListings({ sort: "newest" }, 10),
    searchListings({ sort: "most_viewed" }, 10),
  ]);
  const newestCards = newest.items.map((i) => toListingCardData(i));
  const popularCards = popular.items.map((i) => toListingCardData(i));

  return (
    <>
      <section aria-label="Promotions" className="pt-4">
        <Container>
          <div className="scrollbar-none -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
            {BANNERS.map((b) => (
              <Link
                key={b.id}
                href={b.href}
                className={`flex aspect-[16/8] w-[82%] shrink-0 snap-start flex-col justify-end rounded-xl bg-gradient-to-br p-4 shadow-glass-sm sm:w-[48%] lg:w-[32%] ${b.className}`}
              >
                <p className="font-display text-2xl font-medium leading-tight">{b.title}</p>
                <p className="text-sm opacity-90">{b.subtitle}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
                  {b.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <CategoryTiles />

      {popularCards.length > 0 && (
        <ListingStrip
          eyebrow="Trending now"
          title="Top selling items"
          href="/marketplace?sort=most_viewed"
          listings={popularCards}
        />
      )}
      {newestCards.length > 0 && (
        <ListingStrip eyebrow="Fresh" title="Just in" href="/marketplace?sort=newest" listings={newestCards} />
      )}
    </>
  );
}
