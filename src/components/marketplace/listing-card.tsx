"use client";

import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { formatKes, cn } from "@/utils";

export type ListingCardData = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  isNegotiable: boolean;
  imageUrl: string;
  county: string;
  isVerifiedSeller: boolean;
  sellerName: string;
  favoriteCount: number;
  condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";
  isFavorited?: boolean;
};

const CONDITION_LABEL: Record<ListingCardData["condition"], string> = {
  NEW: "Brand New",
  LIKE_NEW: "Like New",
  GOOD: "Good",
  FAIR: "Fair",
};

export function ListingCard({
  listing,
  className,
  priority = false,
}: {
  listing: ListingCardData;
  className?: string;
  priority?: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-xl border border-border bg-card transition-colors duration-200 hover:border-primary/45 sm:rounded-2xl",
        className
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <Link
          href={`/products/${listing.slug}`}
          aria-label={`View ${listing.title}`}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 640px) 30vw, 48vw"
            priority={priority}
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
          />
        </Link>
        <FavoriteButton
          productId={listing.id}
          initialFavorited={listing.isFavorited ?? false}
          className="absolute right-2 top-2 border border-black/10 bg-black/65 text-white shadow-sm backdrop-blur-sm hover:bg-black/80 hover:text-white sm:right-3 sm:top-3"
        />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/75 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm sm:bottom-3 sm:left-3 sm:text-xs">
          {CONDITION_LABEL[listing.condition]}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-2 p-3 sm:p-3.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="min-w-0 font-mono text-base font-bold tracking-tight tabular-nums text-foreground sm:text-lg">
            {formatKes(listing.priceCents)}
          </p>
          {listing.isNegotiable && (
            <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">
              Negotiable
            </span>
          )}
        </div>

        <Link
          href={`/products/${listing.slug}`}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 className="line-clamp-2 min-h-10 break-words text-xs font-medium leading-5 text-foreground sm:text-sm">
            {listing.title}
          </h3>
        </Link>

        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{listing.county}</span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 border-t border-border pt-2 text-[11px] sm:text-xs">
          <span className="min-w-0 truncate text-muted-foreground">
            {listing.sellerName}
          </span>
          {listing.isVerifiedSeller && (
            <span
              className="inline-flex shrink-0 items-center gap-1 font-medium text-primary-400"
              title="This seller has been verified by MaliHub"
              aria-label="Verified seller"
            >
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
              <span>Verified</span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
