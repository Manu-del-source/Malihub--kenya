"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Heart, MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group relative", className)}
    >
      <Link
        href={`/products/${listing.slug}`}
        className="block overflow-hidden rounded-lg border border-border bg-card transition-shadow duration-300 hover:shadow-glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="object-cover transition-transform duration-500 ease-premium group-hover:scale-105"
          />

          <button
            type="button"
            aria-label={`Save ${listing.title} to wishlist`}
            className="glass absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:text-destructive"
          >
            <Heart className="h-4 w-4" aria-hidden />
          </button>

          {listing.isVerifiedSeller && (
            <Badge variant="verified" className="absolute left-3 top-3 glass-sm">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Verified
            </Badge>
          )}
        </div>

        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-lg font-medium tabular-nums">
              {formatKes(listing.priceCents)}
              {listing.isNegotiable && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  negotiable
                </span>
              )}
            </p>
          </div>

          <h3 className="line-clamp-1 text-sm font-medium text-foreground/90">
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
