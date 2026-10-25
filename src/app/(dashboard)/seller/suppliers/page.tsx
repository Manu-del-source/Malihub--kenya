import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import {
  SupplierCatalogView,
  type CategoryOption,
  type SupplierCatalogItem,
} from "@/components/shell/seller/supplier-catalog-view";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Supplier Catalog — Sourcing",
  description: "Browse approved supplier products and import drafts directly into your MaliHub inventory.",
};

export default async function SellerSuppliersPage() {
  const { user } = await requireSellerAccess();

  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true, businessName: true, verificationStatus: true },
  });
  if (!seller) redirect(BUYER_DASHBOARD_PATH);

  // Load canonical categories and initial approved supplier products
  const [categories, supplierProductsTotal, rawSupplierProducts] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    prisma.supplierProduct.count({
      where: { isActive: true, supplier: { status: "APPROVED" } },
    }),
    prisma.supplierProduct.findMany({
      where: { isActive: true, supplier: { status: "APPROVED" } },
      orderBy: { title: "asc" },
      take: 24,
      select: {
        id: true,
        title: true,
        description: true,
        sku: true,
        sourceUrl: true,
        imageUrl: true,
        currency: true,
        availableQuantity: true,
        lastSyncedAt: true,
        supplier: {
          select: { id: true, name: true, region: true, countryCode: true },
        },
      },
    }),
  ]);

  const supplierProductIds = rawSupplierProducts.map((p) => p.id);
  const importedListings = supplierProductIds.length > 0
    ? await prisma.product.findMany({
        where: {
          sellerId: seller.id,
          supplierProductId: { in: supplierProductIds },
          status: { not: "REMOVED" },
        },
        select: { id: true, slug: true, supplierProductId: true, status: true },
      })
    : [];

  const importedMap = new Map(
    importedListings
      .filter((item): item is typeof item & { supplierProductId: string } => item.supplierProductId !== null)
      .map((item) => [item.supplierProductId, { id: item.id, slug: item.slug, status: item.status }]),
  );

  const initialItems: SupplierCatalogItem[] = rawSupplierProducts.map((product) => ({
    ...product,
    lastSyncedAt: product.lastSyncedAt ? product.lastSyncedAt.toISOString() : null,
    importedListing: importedMap.get(product.id) || null,
  }));

  const initialPagination = {
    page: 1,
    limit: 24,
    total: supplierProductsTotal,
    totalPages: Math.ceil(supplierProductsTotal / 24) || 1,
  };

  const categoryOptions: CategoryOption[] = categories;

  return (
    <Container className="min-h-[calc(100svh-180px)] py-10 text-white sm:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF8C42]/10 text-[#FF8C42]">
              <Boxes className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
              Dropshipping Sourcing
            </span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-medium">Supplier Catalog</h1>
          <p className="mt-1 text-sm text-white/60">
            Source high-demand products from approved Kenyan and international suppliers into your inventory.
          </p>
        </div>

        <Badge variant={seller.verificationStatus === "VERIFIED" ? "verified" : "default"}>
          {seller.verificationStatus === "VERIFIED" ? "Verified Seller" : `Seller: ${seller.verificationStatus}`}
        </Badge>
      </div>

      <SupplierCatalogView
        initialItems={initialItems}
        initialPagination={initialPagination}
        categories={categoryOptions}
        sellerVerified={seller.verificationStatus === "VERIFIED"}
      />
    </Container>
  );
}
