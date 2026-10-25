import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma, SupplierRegion } from "@prisma/client";

export async function GET(request: NextRequest) {
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  if (!user.isActive || user.isBanned) return NextResponse.json({ success: false, error: "Account access denied." }, { status: 403 });

  try {
    const seller = await prisma.seller.findUnique({
      where: { userId: user.id },
      select: { id: true, verificationStatus: true },
    });
    if (!seller) return NextResponse.json({ success: false, error: "Seller setup required." }, { status: 403 });

    const searchParams = request.nextUrl?.searchParams;
    const q = searchParams?.get("q")?.trim() || "";
    const rawRegion = searchParams?.get("region")?.trim();
    const region: SupplierRegion | undefined =
      rawRegion === "KENYA" || rawRegion === "INTERNATIONAL" ? rawRegion : undefined;

    const page = Math.max(1, parseInt(searchParams?.get("page") || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams?.get("limit") || "24", 10) || 24));
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierProductWhereInput = {
      isActive: true,
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

    const items = supplierProducts.map((product) => ({
      ...product,
      importedListing: importedMap.get(product.id) || null,
    }));

    return NextResponse.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      sellerVerified: seller.verificationStatus === "VERIFIED",
    });
  } catch (error) {
    console.error("GET /api/seller/supplier-products failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load supplier catalog." },
      { status: 500 },
    );
  }
}
