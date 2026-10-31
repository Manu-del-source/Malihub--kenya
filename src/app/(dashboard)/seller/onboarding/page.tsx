import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { SellerApplicationForm } from "@/components/seller/seller-application-form";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Become a seller — MaliHub" };

export default async function SellerOnboardingPage() {
  const { user } = await requireUser();
  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: {
      businessName: true,
      description: true,
      county: true,
      subCounty: true,
      kraPin: true,
      verificationStatus: true,
    },
  });

  if (!seller) redirect("/seller-center");

  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-300">
          MaliHub seller programme
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Apply to sell on MaliHub
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Set up your shop profile so buyers know who they are purchasing from. MaliHub reviews seller applications before approving sellers to publish new listings.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card/90 p-5 shadow-2xl shadow-black/20 sm:p-8">
        <SellerApplicationForm application={seller} />
      </div>
    </Container>
  );
}
