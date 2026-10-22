"use client";

import Link from "next/link";
import { ShieldCheck, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function SellerInfoCard({
  seller,
  contactPreference,
  whatsapp,
  isOwnListing,
}: {
  seller: {
    businessName: string;
    slug: string;
    logoUrl: string | null;
    verificationStatus: string;
    ratingAverage: unknown;
    ratingCount?: number;
    county: string;
  };
  contactPreference: "CALL" | "WHATSAPP" | "CHAT" | "ANY";
  whatsapp?: string | null;
  isOwnListing?: boolean;
}) {
  const rating = Number(seller.ratingAverage as never) || 0;
  const showWhatsapp = (contactPreference === "WHATSAPP" || contactPreference === "ANY") && whatsapp;

  return (
    <div className="glass flex flex-col gap-4 rounded-2xl p-5">
      <Link href={`/sellers/${seller.slug}`} className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-medium text-primary-foreground">
          {seller.businessName[0]?.toUpperCase()}
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {seller.businessName}
            {seller.verificationStatus === "VERIFIED" && (
              <ShieldCheck className="h-3.5 w-3.5 text-cyan" aria-hidden />
            )}
          </p>
          <p className="text-xs text-muted-foreground">{seller.county}</p>
        </div>
      </Link>

      <div className="flex items-center gap-1.5 text-sm">
        <Star
          className={rating > 0 ? "h-4 w-4 fill-primary-400 text-primary-400" : "h-4 w-4 text-muted-foreground/40"}
          aria-hidden
        />
        <span className="font-medium text-foreground">{rating > 0 ? rating.toFixed(1) : "New seller"}</span>
        {rating > 0 && (
          <span className="text-xs text-muted-foreground">({seller.ratingCount ?? 0} reviews)</span>
        )}
      </div>

      {seller.verificationStatus === "VERIFIED" && (
        <Badge variant="verified" className="w-fit">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          ID verified
        </Badge>
      )}

      {!isOwnListing && showWhatsapp && (
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a
              href={`https://wa.me/${whatsapp!.replace(/\\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp seller
            </a>
          </Button>
        </div>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        Meet in a public place. Never pay before seeing the item.
      </p>
    </div>
  );
}
