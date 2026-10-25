import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  if (!user.isActive || user.isBanned) return NextResponse.json({ success: false, error: "Account access denied." }, { status: 403 });

  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!seller) return NextResponse.json({ success: false, error: "Seller setup required." }, { status: 403 });

  const data = await prisma.supplierProduct.findMany({
    where: { isActive: true, supplier: { status: "APPROVED" } },
    orderBy: { title: "asc" },
    take: 100,
    select: {
      id: true, title: true, description: true, sku: true, sourceUrl: true,
      imageUrl: true, currency: true, availableQuantity: true, lastSyncedAt: true,
      supplier: { select: { id: true, name: true, region: true, countryCode: true } },
    },
  });
  return NextResponse.json({ success: true, data });
}
