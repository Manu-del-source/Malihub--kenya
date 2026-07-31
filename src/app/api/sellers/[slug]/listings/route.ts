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

  if (!seller || seller.verificationStatus === "UNVERIFIED") {
    return NextResponse.json({ success: false, error: "Seller not found." }, { status: 404 });
  }

  const listings = await prisma.product.findMany({
    where: { sellerId: seller.id, status: "ACTIVE" },
    include: { images: { orderBy: { sortOrder: "asc" }, take: 1 }, category: true },
    orderBy: { publishedAt: "desc" },
  });

  return NextResponse.json({ success: true, data: { seller, listings } });
}
