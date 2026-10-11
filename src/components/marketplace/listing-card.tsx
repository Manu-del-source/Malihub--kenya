"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Clock3, MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { formatKes, timeAgo, cn } from "@/utils";

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
}: {
  listing: ListingCardData;
  className?: string;
  priority?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group relative min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg", className)}
    >
      <Link
        href={`/products/${listing.slug}`}
        className="block overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-square overflow-hidden bg-muted">
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
            priority={priority}
            className="object-cover transition-transform duration-500 ease-premium group-hover:scale-105"
          />

          <FavoriteButton
            productId={listing.id}
            initialFavorited={listing.isFavorited ?? false}
            className="absolute right-3 top-3"
          />

          {listing.isVerifiedSeller && (
            <Badge variant="verified" className="absolute left-3 top-3 glass-sm">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Verified
            </Badge>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2.5 p-3 sm:p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-base font-bold tracking-tight tabular-nums sm:text-lg">
              {formatKes(listing.priceCents)}
              {listing.isNegotiable && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  negotiable
                </span>
              )}
            </p>
          </div>

          <h3 className="line-clamp-1 line-clamp-2 min-h-10 text-[13px] font-medium leading-5 text-foreground/90 sm:text-sm">
            {listing.title}
          </h3>

          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {listing.county}
            </span>
            <span className="text-border">·</span>
            <Clock3 className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{timeAgo(listing.postedAt)}</span>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-2.5 text-xs">
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
