import { logServerError } from "@/lib/safe-log";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_SELECT, toPublicProduct } from "@/lib/catalog/public-product";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
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
      where: { sellerId: seller.id, status: "ACTIVE", seller: { verificationStatus: "VERIFIED" } },
      select: PUBLIC_PRODUCT_SELECT,
      orderBy: { publishedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        seller: {
          id: seller.id,
          businessName: seller.businessName,
          verificationStatus: seller.verificationStatus,
          ratingAverage: Number(seller.ratingAverage),
          ratingCount: seller.ratingCount,
          county: seller.county,
        },
        listings: listings.map(toPublicProduct),
      },
    });
  } catch (error) {
    logServerError("GET /api/sellers/[slug]/listings failed", error);
    return NextResponse.json({ success: false, error: "Couldn't load seller listings." }, { status: 500 });
  }
}
