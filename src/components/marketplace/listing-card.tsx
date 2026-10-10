"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { formatKes, timeAgo } from "@/utils";
import { cn } from "@/utils";

/**
 * Deliberately decoupled from Prisma's generated types: this is the shape
 * the *card* needs to render, not a 1:1 mirror of the database row. Phase 5
 * maps `ProductWithRelations` (see src/types/index.ts) into this shape at
 * the query boundary, so the card itself never has to change.
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

export function ListingCard({
  listing,
  className,
  priority = false,
  compact = false,
}: {
  listing: ListingCardData;
  className?: string;
  priority?: boolean;
  /** Denser marketplace-style card for app screens (square image, 2-line title). */
  compact?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group relative", className)}
    >
      <Link
        href={`/products/${listing.slug}`}
        className="block overflow-hidden rounded-lg border border-border bg-card transition-shadow duration-300 hover:shadow-glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className={cn("relative overflow-hidden bg-muted", compact ? "aspect-square" : "aspect-[4/3]")}>
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes={compact ? "(min-width: 1024px) 280px, (min-width: 640px) 31vw, 46vw" : "(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"}
            priority={priority}
            className="object-cover transition-transform duration-500 ease-premium group-hover:scale-105"
          />

          <FavoriteButton
            productId={listing.id}
            initialFavorited={listing.isFavorited ?? false}
            className={compact ? "absolute right-2 top-2" : "absolute right-3 top-3"}
          />

          {listing.isVerifiedSeller && (
            <Badge variant="verified" className={cn("absolute glass-sm", compact ? "left-2 top-2" : "left-3 top-3")}>
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Verified
            </Badge>
          )}
        </div>

        <div className={cn("flex flex-col", compact ? "gap-1.5 p-3" : "gap-2 p-4")}>
          <div className="flex items-start justify-between gap-2">
            <p className={cn("font-mono font-medium tabular-nums", compact ? "text-base font-semibold sm:text-lg" : "text-lg")}>
              {formatKes(listing.priceCents)}
              {listing.isNegotiable && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  negotiable
                </span>
              )}
            </p>
          </div>

          <h3 className={cn("text-foreground/90", compact ? "line-clamp-2 min-h-[2.5rem] text-[13px] leading-snug" : "line-clamp-1 text-sm font-medium")}>
            {listing.title}
          </h3>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {listing.county}
            </span>
            <span>{timeAgo(listing.postedAt)}</span>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
            <span className="text-muted-foreground">{listing.sellerName}</span>
            <Badge variant="default" className="text-[10px]">
              {CONDITION_LABEL[listing.condition]}
            </Badge>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
