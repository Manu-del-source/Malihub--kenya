import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdministratorRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";

const schema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  sku: z.string().trim().max(120).optional(),
  externalProductId: z.string().trim().max(200).optional(),
  sourceUrl: z.string().trim().url().max(2048).optional(),
  imageUrl: z.string().trim().url().max(2048).optional(),
  costMinor: z.number().int().nonnegative().max(2_000_000_000),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  availableQuantity: z.number().int().nonnegative().nullable().optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  if (!isAdministratorRole(user.role) || !user.isActive || user.isBanned) {
    return NextResponse.json({ success: false, error: "Administrator access is required." }, { status: 403 });
  }

  const { id: supplierId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) return NextResponse.json({ success: false, error: "Supplier not found." }, { status: 404 });

  const v = parsed.data;
  try {
    const data = await prisma.supplierProduct.create({
      data: {
        supplierId,
        title: v.title,
        description: v.description || null,
        sku: v.sku || null,
        externalProductId: v.externalProductId || null,
        sourceUrl: v.sourceUrl || null,
        imageUrl: v.imageUrl || null,
        costMinor: v.costMinor,
        currency: v.currency,
        availableQuantity: v.availableQuantity ?? null,
      },
      select: {
        id: true, supplierId: true, title: true, sku: true,
        currency: true, availableQuantity: true, isActive: true, createdAt: true,
      },
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "This external product ID already exists for the supplier." }, { status: 409 });
    }
    console.error("POST /api/admin/suppliers/[id]/products failed", error);
    return NextResponse.json({ success: false, error: "Unable to create supplier product." }, { status: 500 });
  }
}
