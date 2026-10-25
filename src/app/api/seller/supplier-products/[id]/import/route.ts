import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { KENYA_COUNTIES } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/utils";

const importSchema = z.object({
  categorySlug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  priceCents: z.number().int().min(100).max(2_000_000_000),
  county: z.enum(KENYA_COUNTIES as [string, ...string[]]),
  town: z.string().trim().min(2).max(80),
  quantity: z.number().int().min(1).max(9999).default(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }
  if (!user.isActive || user.isBanned) {
    return NextResponse.json({ success: false, error: "Account access denied." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const seller = await prisma.seller.findUnique({
      where: { userId: user.id },
      select: { id: true, verificationStatus: true },
    });
    if (!seller) {
      return NextResponse.json({ success: false, error: "Seller setup required." }, { status: 403 });
    }
    if (seller.verificationStatus !== "VERIFIED") {
      return NextResponse.json(
        { success: false, error: "Seller verification is required before importing supplier products." },
        { status: 403 },
      );
    }

    const { id: supplierProductId } = await context.params;
    const [source, category, existing] = await Promise.all([
      prisma.supplierProduct.findFirst({
        where: { id: supplierProductId, isActive: true, supplier: { status: "APPROVED" } },
        select: {
          id: true,
          title: true,
          description: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.category.findUnique({
        where: { slug: parsed.data.categorySlug },
        select: { id: true },
      }),
      prisma.product.findFirst({
        where: { sellerId: seller.id, supplierProductId, status: { not: "REMOVED" } },
        select: { id: true, slug: true },
      }),
    ]);

    if (!source) {
      return NextResponse.json(
        { success: false, error: "Supplier product is unavailable or its supplier is not approved." },
        { status: 404 },
      );
    }
    if (!category) {
      return NextResponse.json({ success: false, error: "Select a valid category." }, { status: 400 });
    }
    if (existing) {
      return NextResponse.json(
        { success: false, error: "You have already imported this supplier product.", data: existing },
        { status: 409 },
      );
    }

    const product = await prisma.product.create({
      data: {
        ownerId: user.id,
        sellerId: seller.id,
        categoryId: category.id,
        supplierProductId: source.id,
        title: source.title,
        slug: `${slugify(source.title)}-${randomUUID().slice(0, 8)}`,
        description: source.description?.trim()
          ? `${source.description.trim()}\n\nSourced via MaliHub from ${source.supplier.name}. Verify product details and availability before publishing.`
          : `Supplier-sourced product from ${source.supplier.name}. Verify product details and availability before publishing.`,
        priceCents: parsed.data.priceCents,
        isNegotiable: false,
        condition: "NEW",
        quantity: parsed.data.quantity,
        contactPreference: "ANY",
        county: parsed.data.county,
        subCounty: parsed.data.town,
        status: "DRAFT",
        publishedAt: null,
      },
      select: { id: true, title: true, slug: true, status: true, priceCents: true, createdAt: true },
    });

    return NextResponse.json(
      {
        success: true,
        data: product,
        message: "Imported as a draft. Add an approved product image and verify details before publishing.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/seller/supplier-products/[id]/import failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to import supplier product." },
      { status: 500 },
    );
  }
}
