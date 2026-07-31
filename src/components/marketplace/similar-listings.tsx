import { SectionHeading } from "@/components/ui/section-heading";
import { ListingCard } from "@/components/marketplace/listing-card";
import { toListingCardData } from "@/lib/mappers";
import type { ProductWithRelations } from "@/types";

export function SimilarListings({ listings }: { listings: ProductWithRelations[] }) {
  if (listings.length === 0) return null;

  return (
    <section className="mt-16">
      <SectionHeading align="left" title="Similar listings" className="mb-6" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={toListingCardData(listing)} />
        ))}
      </div>
    </section>
  );
}
