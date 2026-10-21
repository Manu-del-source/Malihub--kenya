"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <motion.article
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className={cn("group relative min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card transition-colors duration-200 hover:border-primary/40 sm:rounded-2xl", className)}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        <Link href={`/products/${listing.slug}`} aria-label={`View ${listing.title}`} className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 640px) 30vw, 48vw"
            priority={priority}
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        </Link>
        <FavoriteButton
          productId={listing.id}
          initialFavorited={listing.isFavorited ?? false}
          className="absolute right-2 top-2 sm:right-3 sm:top-3"
        />
        {listing.isVerifiedSeller && (
          <Badge variant="verified" className="absolute left-2 top-2 max-w-[calc(100%-3.5rem)] glass-sm sm:left-3 sm:top-3">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            <span className="hidden sm:inline">Verified</span>
          </Badge>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 p-2.5 sm:gap-2.5 sm:p-3.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <p className="min-w-0 font-mono text-sm font-bold tracking-tight tabular-nums sm:text-lg">
            {formatKes(listing.priceCents)}
          </p>
          {listing.isNegotiable && (
            <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">Negotiable</span>
          )}
        </div>

        <Link href={`/products/${listing.slug}`} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <h3 className="line-clamp-2 min-h-9 break-words text-xs font-medium leading-4 text-foreground/90 sm:min-h-10 sm:text-sm sm:leading-5">
            {listing.title}
          </h3>
        </Link>

        <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground sm:gap-1.5 sm:text-xs">
          <MapPin className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
          <span className="truncate">{listing.county}</span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-1 border-t border-border pt-2 text-[10px] sm:pt-2.5 sm:text-xs">
          <span className="min-w-0 truncate text-muted-foreground">{listing.sellerName}</span>
          <Badge variant="default" className="max-w-[48%] shrink-0 truncate px-1.5 text-[9px] sm:px-2 sm:text-[10px]">
            {CONDITION_LABEL[listing.condition]}
          </Badge>
        </div>
      </div>
    </motion.article>
  );
}
