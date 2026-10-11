import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { ListingForm } from "@/components/marketplace/listing-form";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Create a listing" };

export default async function NewListingPage() {
  const { user } = await requireUser();
  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { verificationStatus: true },
  });
  if (!seller) redirect("/account");
  if (seller.verificationStatus !== "VERIFIED") redirect("/seller/onboarding");

  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-1 font-display text-3xl font-medium">Create a listing</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Add clear photos and an accurate description — listings with 3+ photos get noticed faster.
      </p>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <ListingForm />
      </div>
    </Container>
  );
}
