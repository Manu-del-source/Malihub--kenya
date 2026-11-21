"use client";

import { useEffect, useRef } from "react";
import { Loader2, SearchX } from "lucide-react";
import { ListingCard, type ListingCardData } from "@/components/marketplace/listing-card";
import { ListingGridSkeleton } from "@/components/marketplace/listing-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useSearchListings } from "@/hooks/use-search-listings";

export function SearchResultsGrid({
  searchParamsString,
  initialItems,
  initialNextCursor,
  initialHasMore,
  emptyTitle = "No listings match your search",
  emptyDescription = "Try adjusting your filters or searching a broader term.",
  autoScroll = false,
}: {
  searchParamsString: string;
  initialItems: ListingCardData[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  autoScroll?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useSearchListings(
    searchParamsString,
    { items: initialItems, nextCursor: initialNextCursor, hasMore: initialHasMore }
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "500px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const pages = data?.pages ?? [
    { items: initialItems, nextCursor: initialNextCursor, hasMore: initialHasMore },
  ];
  const items = pages.flatMap((p) => p.items);
  const hasMore = data ? (hasNextPage ?? false) : initialHasMore;

  if (isLoading && items.length === 0) return <ListingGridSkeleton />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  if (autoScroll) {
    const loopItems = items.length < 5 ? [...items, ...items, ...items] : [...items, ...items];
    return (
      <div className="homepage-product-marquee" aria-label="Scrolling product listings">
        <div className="homepage-product-marquee__track">
          {[0, 1].map((copy) => (
            <div className="homepage-product-marquee__group" key={copy} aria-hidden={copy === 1}>
              {loopItems.map((listing, i) => (
                <ListingCard key={`${copy}-${listing.id}-${i}`} listing={listing} priority={i < 2} className="homepage-product-marquee__card" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((listing, i) => (
          <ListingCard key={listing.id} listing={listing} priority={i < 2} />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-8 sm:py-10" aria-label="Loading more listings">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      )}
    </div>
  );
}
