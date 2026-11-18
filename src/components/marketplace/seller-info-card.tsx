"use client";

import Link from "next/link";
import { BadgeCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SellerVerificationStatus } from "@/types";

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
    verificationStatus: SellerVerificationStatus;
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
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {seller.businessName}
            {seller.verificationStatus === "VERIFIED" && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified seller" />
            )}
          </p>
          <p className="text-xs text-muted-foreground">{seller.county} · Seller profile</p>
        </div>
      </Link>

      {seller.verificationStatus === "VERIFIED" && (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          MaliHub verified seller
        </p>
      )}

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

      {!isOwnListing && showWhatsapp && (
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a
              href={`https://wa.me/${whatsapp!.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Contact seller on WhatsApp"
            >
              <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4 fill-current" aria-hidden="true">
                <path d="M20.52 3.48A11.8 11.8 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.37-1.67a11.86 11.86 0 0 0 5.67 1.44h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.24-6.15-3.39-8.43zM12.05 21.75h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.78.99 1.01-3.69-.23-.38a9.84 9.84 0 0 1-1.51-5.22c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.89-9.89 9.89zm5.43-7.4c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01s-.52.07-.79.37c-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.17.2 2.1 3.2 5.09 4.49.71.31 1.26.5 1.69.64.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" />
              </svg>
              WhatsApp seller
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
