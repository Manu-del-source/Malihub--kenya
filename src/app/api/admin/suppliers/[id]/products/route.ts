import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierProductStatus } from "@prisma/client";
import { supplierProductCreateSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import {
  isPrismaErrorCode,
  logSafeError,
  requireAdminActor,
} from "@/lib/dropshipping/http";
import { ADMIN_SUPPLIER_PRODUCT_SELECT } from "@/lib/dropshipping/selects";

/**
 * Supplier product submissions. A product is NEVER seller-visible merely
 * because it was submitted: it starts DRAFT or PENDING_REVIEW and an admin
 * must approve it with verified stock/cost/delivery information.
 */

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier id." }, { status: 400 });
  }
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20));
  const status = params.get("status");
  const where: Prisma.SupplierProductWhereInput = {
    supplierId: id,
    ...(status && ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "REMOVED"].includes(status)
      ? { approvalStatus: status as SupplierProductStatus }
      : {}),
  };
  try {
    const [total, data] = await Promise.all([
      prisma.supplierProduct.count({ where }),
      prisma.supplierProduct.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: ADMIN_SUPPLIER_PRODUCT_SELECT,
      }),
    ]);
    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logSafeError("GET /api/admin/suppliers/[id]/products failed", error);
    return NextResponse.json({ success: false, error: "Unable to load supplier products." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const { id: supplierId } = await context.params;
  if (!uuidSchema.safeParse(supplierId).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier id." }, { status: 400 });
  }
  const parsed = supplierProductCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const v = parsed.data;
  const optional = (value?: string) => (value && value.length > 0 ? value : null);
  const approvalStatus: SupplierProductStatus = v.submitForReview ? "PENDING_REVIEW" : "DRAFT";

  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, status: true },
    });
    if (!supplier) return NextResponse.json({ success: false, error: "Supplier not found." }, { status: 404 });
    if (supplier.status === "REJECTED" || supplier.status === "SUSPENDED") {
      return NextResponse.json(
        { success: false, error: "Products cannot be submitted for a rejected or suspended supplier." },
        { status: 409 },
      );
    }

    const data = await prisma.supplierProduct.create({
      data: {
        supplierId,
        title: v.title,
        description: optional(v.description),
        sku: optional(v.sku),
        externalProductId: optional(v.externalProductId),
        sourceUrl: optional(v.sourceUrl),
        imageUrl: optional(v.imageUrl),
        costMinor: v.costMinor,
        currency: v.currency,
        deliveryChargeMinor: v.deliveryChargeMinor ?? null,
        availableQuantity: v.availableQuantity ?? null,
        isActive: true,
        approvalStatus,
        submittedAt: v.submitForReview ? new Date() : null,
        stockStatus: "UNKNOWN",
        costStatus: "ESTIMATED",
        manualRefreshRequired: true,
      },
      select: {
        id: true, supplierId: true, title: true, sku: true, currency: true,
        availableQuantity: true, isActive: true, approvalStatus: true, createdAt: true,
      },
    });
    if (v.submitForReview) {
      await logAuditEvent({
        action: "supplier_product.submitted",
        actorId: guard.actor.id,
        actorEmail: guard.actor.email,
        targetType: "supplier_product",
        targetId: data.id,
        metadata: { supplierId, approvalStatus },
      }).catch(() => undefined);
    }
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      return NextResponse.json(
        { success: false, error: "This external product ID already exists for the supplier." },
        { status: 409 },
      );
    }
    logSafeError("POST /api/admin/suppliers/[id]/products failed", error);
    return NextResponse.json({ success: false, error: "Unable to create supplier product." }, { status: 500 });
  }
}
