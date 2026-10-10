import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";

/**
 * Horizontal, swipeable product row (marketplace-style) in MaliHub's own
 * copper/dusk look: a softly tinted panel instead of a flat colour block.
 */
export function ListingStrip({
  title,
  eyebrow,
  href = "/marketplace",
  listings,
}: {
  title: string;
  eyebrow?: string;
  href?: string;
  listings: ListingCardData[];
}) {
  return (
    <section className="py-4 sm:py-6">
      <Container>
        <div className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-50 via-card to-card pb-4">
          <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <div>
              {eyebrow && (
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
              )}
              <h2 className="font-display text-xl font-medium sm:text-2xl">{title}</h2>
            </div>
            <Link
              href={href}
              aria-label={`See all: ${title}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <span className="hidden sm:inline">See all</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <div className="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 sm:px-6">
            {listings.map((l) => (
              <div key={l.id} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[22%]">
                <ListingCard listing={l} />
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
