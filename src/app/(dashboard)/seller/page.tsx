import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Seller dashboard" };

export default async function SellerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const seller = user
    ? await prisma.seller.findUnique({
        where: { userId: user.id },
        select: { businessName: true, verificationStatus: true },
      })
    : null;

  return (
    <Container className="py-16">
      <div className="glass rounded-2xl p-10 text-center">
        <Badge variant={seller?.verificationStatus === "VERIFIED" ? "verified" : "default"} className="mx-auto">
          {seller?.verificationStatus ?? "UNVERIFIED"}
        </Badge>
        <h1 className="mt-3 font-display text-3xl font-medium">{seller?.businessName}</h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          Listings, orders, earnings, and analytics land here in Phase 6. Your seller profile
          was created automatically when you completed onboarding.
        </p>
      </div>
    </Container>
  );
}
