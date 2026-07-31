import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { ListingForm } from "@/components/marketplace/listing-form";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Edit listing" };

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: "asc" } }, category: true },
  });

  if (!product || product.ownerId !== user.id) notFound();

  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-1 font-display text-3xl font-medium">Edit listing</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Changes go live immediately for published listings.
      </p>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <ListingForm
          productId={product.id}
          defaultValues={{
            title: product.title,
            description: product.description,
            categorySlug: product.category.slug,
            condition: product.condition,
            brand: product.brand ?? "",
            priceCents: product.priceCents,
            isNegotiable: product.isNegotiable,
            quantity: product.quantity,
            county: product.county as ListingFormCounty,
            town: product.subCounty ?? "",
            contactPreference: product.contactPreference,
            images: product.images.map((img: { url: string; cloudinaryId: string }) => ({ url: img.url, cloudinaryId: img.cloudinaryId })),
            status: product.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
          }}
        />
      </div>
    </Container>
  );
}

// Prisma's `county` column is a plain string; the form schema narrows it to
// the KENYA_COUNTIES union. Casting here (not `as any`) keeps the narrowing
// explicit at the one boundary where a DB string becomes a validated enum.
type ListingFormCounty = import("@/lib/constants").KenyaCounty;
