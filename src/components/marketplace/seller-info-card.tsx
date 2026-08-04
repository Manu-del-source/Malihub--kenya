"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Star, MessageCircle, Phone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startChatAction } from "@/app/(dashboard)/messages/actions";

export function SellerInfoCard({
  seller,
  sellerUserId,
  productId,
  contactPreference,
  whatsapp,
  phone,
  isOwnListing,
}: {
  seller: {
    businessName: string;
    slug: string;
    logoUrl: string | null;
    verificationStatus: string;
    ratingAverage: unknown; // Prisma.Decimal — coerced for display only
    ratingCount?: number;
    county: string;
  };
  sellerUserId: string;
  productId: string;
  contactPreference: "CALL" | "WHATSAPP" | "CHAT" | "ANY";
  whatsapp?: string | null;
  phone?: string | null;
  isOwnListing?: boolean;
}) {
  const router = useRouter();
  const [isStartingChat, startTransition] = useTransition();
  const rating = Number(seller.ratingAverage as never) || 0;

  const showCall = (contactPreference === "CALL" || contactPreference === "ANY") && phone;
  const showWhatsapp = (contactPreference === "WHATSAPP" || contactPreference === "ANY") && whatsapp;
  const showChat = contactPreference === "CHAT" || contactPreference === "ANY";

  function handleChatClick() {
    startTransition(async () => {
      const result = await startChatAction({ sellerId: sellerUserId, productId });
      if (!result.success) {
        if (result.error.includes("Sign in")) {
          toast.error("Sign in to message this seller.");
          router.push("/login");
          return;
        }
        toast.error(result.error);
        return;
      }
      router.push(`/messages/${result.data.chatId}`);
    });
  }

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

      <div className="flex flex-col gap-2">
        {!isOwnListing && showChat && (
          <Button size="lg" className="w-full" onClick={handleChatClick} disabled={isStartingChat}>
            {isStartingChat ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />}
            Chat with seller
          </Button>
        )}
        {!isOwnListing && showCall && (
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <a href={`tel:${phone}`}>
              <Phone className="h-4 w-4" aria-hidden />
              Call seller
            </a>
          </Button>
        )}
        {!isOwnListing && showWhatsapp && (
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a
              href={`https://wa.me/${whatsapp!.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp seller
            </a>
          </Button>
        )}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Meet in a public place. Never pay before seeing the item.
      </p>
    </div>
  );
}
