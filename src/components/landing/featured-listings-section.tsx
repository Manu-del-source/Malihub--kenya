import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { FEATURED_LISTINGS } from "@/lib/landing-data";

/** Orange horizontal product strip, like Jumia's "Top selling items". */
export function ListingStrip({
  title,
  href = "/marketplace",
  listings,
  id,
}: {
  title: string;
  href?: string;
  listings: ListingCardData[];
  id?: string;
}) {
  return (
    <section id={id} className="container my-3">
      <div className="overflow-hidden rounded-xl bg-primary pb-3">
        <div className="flex items-center justify-between px-3 py-3">
          <h2 className="text-lg font-bold text-primary-foreground">{title}</h2>
          <Link
            href={href}
            aria-label={`See all: ${title}`}
            className="grid h-7 w-12 place-items-center rounded-full bg-white text-primary"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto px-3">
          {listings.map((l) => (
            <div key={l.id} className="w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-[19%]">
              <ListingCard listing={l} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FeaturedListingsSection() {
  return <ListingStrip title="Top selling items" listings={FEATURED_LISTINGS} />;
}
