import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const seller = await prisma.seller.findUnique({
    where: { slug },
    select: {
      id: true,
      businessName: true,
      verificationStatus: true,
      ratingAverage: true,
      ratingCount: true,
      county: true,
    },
  });

  if (!seller || seller.verificationStatus !== "VERIFIED") {
    return NextResponse.json({ success: false, error: "Seller not found." }, { status: 404 });
  }

  const listings = await prisma.product.findMany({
    where: { sellerId: seller.id, status: "ACTIVE" },
    select: {
      id: true, title: true, slug: true, description: true, priceCents: true, isNegotiable: true,
      condition: true, brand: true, quantity: true, county: true, subCounty: true, status: true,
      isFeatured: true, publishedAt: true,
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true, url: true, sortOrder: true, isPrimary: true } },
      category: { select: { id: true, name: true, slug: true, iconName: true, imageUrl: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  return NextResponse.json({
    success: true,
    data: {
      seller: {
        businessName: seller.businessName,
        verificationStatus: seller.verificationStatus,
        ratingAverage: seller.ratingAverage,
        ratingCount: seller.ratingCount,
        county: seller.county,
      },
      listings,
    },
  });
}
