import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierRegion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveActor, logSafeError } from "@/lib/dropshipping/http";
import { SELLER_SUPPLIER_PRODUCT_SELECT } from "@/lib/dropshipping/selects";
import { readDropshippingConfig } from "@/lib/dropshipping/config";
import { classifySupplierAvailability } from "@/lib/dropshipping/availability";

/**
 * Seller catalog — approved products only, with an explicit stock-freshness
 * classification. Supplier cost, delivery charge, contact details, internal
 * notes, feed configuration and review notes are never selected here.
 */
export async function GET(request: NextRequest) {
  const guard = await requireActiveActor();
  if (!guard.ok) return guard.response;

  try {
    const seller = await prisma.seller.findUnique({
      where: { userId: guard.actor.id },
      select: { id: true, verificationStatus: true },
    });
    if (!seller) return NextResponse.json({ success: false, error: "Seller setup required." }, { status: 403 });

    const searchParams = request.nextUrl?.searchParams;
    const q = searchParams?.get("q")?.trim() || "";
    const rawRegion = searchParams?.get("region")?.trim();
    const region: SupplierRegion | undefined =
      rawRegion === "KENYA" || rawRegion === "INTERNATIONAL" ? rawRegion : undefined;

    const page = Math.max(1, Number.parseInt(searchParams?.get("page") || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams?.get("limit") || "24", 10) || 24));
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierProductWhereInput = {
      isActive: true,
      approvalStatus: "APPROVED",
      supplier: {
        status: "APPROVED",
        ...(region ? { region } : {}),
      },
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, supplierProducts] = await Promise.all([
      prisma.supplierProduct.count({ where }),
      prisma.supplierProduct.findMany({
        where,
        orderBy: { title: "asc" },
        skip,
        take: limit,
        select: {
          ...SELLER_SUPPLIER_PRODUCT_SELECT,
          supplier: {
            select: {
              ...SELLER_SUPPLIER_PRODUCT_SELECT.supplier.select,
              status: true,
            },
          },
        },
      }),
    ]);

    const supplierProductIds = supplierProducts.map((p) => p.id);
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

    const config = readDropshippingConfig();
    const items = supplierProducts.map((product) => ({
      ...product,
      availability: classifySupplierAvailability({
        supplierStatus: product.supplier.status,
        approvalStatus: product.approvalStatus,
        isActive: product.isActive ?? true,
        stockStatus: product.stockStatus,
        availableQuantity: product.availableQuantity,
        stockVerifiedAt: product.stockVerifiedAt,
        lastSyncedAt: product.lastSyncedAt,
        maxAgeHours: config.stockMaxAgeHours,
      }),
      importedListing: importedMap.get(product.id) || null,
    }));

    return NextResponse.json({
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
      sellerVerified: seller.verificationStatus === "VERIFIED",
      stockPolicy: { maxAgeHours: config.stockMaxAgeHours, isSnapshot: true, isGuaranteed: false },
    });
  } catch (error) {
    logSafeError("GET /api/seller/supplier-products failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load supplier catalog." },
      { status: 500 },
    );
  }
}
