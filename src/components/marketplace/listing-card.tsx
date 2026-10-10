"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, ShieldCheck } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { formatKes, timeAgo } from "@/utils";
import { cn } from "@/utils";

/**
 * Deliberately decoupled from Prisma's generated types: this is the shape
 * the *card* needs to render, not a 1:1 mirror of the database row.
 */
export type ListingCardData = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  isNegotiable: boolean;
  imageUrl: string;
  county: string;
  postedAt: string;
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

/** Jumia-style product card: flat white, square image, 2-line title, bold price. */
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
    <div className={cn("group relative", className)}>
      <Link
        href={`/products/${listing.slug}`}
        className="block overflow-hidden rounded-md bg-card shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-square overflow-hidden bg-neutral-200 dark:bg-muted">
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 44vw"
            priority={priority}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <FavoriteButton
            productId={listing.id}
            initialFavorited={listing.isFavorited ?? false}
            className="absolute right-2 top-2"
          />
          {listing.isVerifiedSeller && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Verified
            </span>
          )}
        </div>

        <div className="space-y-1 p-2.5">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[12.5px] leading-snug">{listing.title}</h3>
          <p className="text-base font-bold tabular-nums">
            {formatKes(listing.priceCents)}
            {listing.isNegotiable && (
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">negotiable</span>
            )}
          </p>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden />
              {listing.county}
            </span>
            <span>{timeAgo(listing.postedAt)}</span>
          </div>
          <span className="inline-block rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-600">
            {CONDITION_LABEL[listing.condition]}
          </span>
        </div>
      </Link>
    </div>
  );
}
