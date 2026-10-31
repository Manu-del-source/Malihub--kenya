import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { Container } from "@/components/ui/container";
import { ListingForm } from "@/components/marketplace/listing-form";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit listing" };

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { user } = await requireUser();

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      category: true,
      supplierProduct: {
        select: {
          id: true,
          title: true,
          supplier: { select: { name: true, region: true } },
        },
      },
    },
  });

  if (!product || product.ownerId !== user.id) notFound();

  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-1 font-display text-3xl font-medium">Edit listing</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Changes go live immediately for published listings.
      </p>

      {product.supplierProduct && (
        <div className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-amber-200">
                  Supplier-sourced draft listing ({product.supplierProduct.supplier.name})
                </h2>
              </div>
              <p className="mt-1 text-foreground/80">
                This listing was imported from an approved supplier. Before publishing to the marketplace:
              </p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                <li>Upload verified product images through the image upload grid below.</li>
                <li>Confirm real-time product availability and delivery timelines with the supplier.</li>
                <li>Verify title, description, category, and intended retail price.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

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
