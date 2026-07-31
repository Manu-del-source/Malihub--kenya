import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        iconName: true,
        _count: { select: { products: { where: { status: "ACTIVE" } } } },
      },
    });

    return NextResponse.json({
      success: true,
      data: categories.map((c: (typeof categories)[number]) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        iconName: c.iconName,
        listingCount: c._count.products,
      })),
    });
  } catch (error) {
    console.error("GET /api/categories failed", error);
    return NextResponse.json({ success: false, error: "Couldn't load categories." }, { status: 500 });
  }
}
