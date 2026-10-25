import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierProductStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";
import { ADMIN_SUPPLIER_PRODUCT_SELECT } from "@/lib/dropshipping/selects";

/** Paginated admin review queue. Costs/contacts here are admin-only by design. */
export async function GET(request: NextRequest) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const supplierId = params.get("supplierId");
  const q = params.get("q")?.trim() ?? "";
  const stale = params.get("stale") === "true";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20));
  const where: Prisma.SupplierProductWhereInput = {
    ...(status && ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "REMOVED"].includes(status)
      ? { approvalStatus: status as SupplierProductStatus }
      : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(stale ? { manualRefreshRequired: true } : {}),
    ...(q
      ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] }
      : {}),
  };

  try {
    const [total, data] = await Promise.all([
      prisma.supplierProduct.count({ where }),
      prisma.supplierProduct.findMany({
        where,
        orderBy: [{ approvalStatus: "asc" }, { createdAt: "desc" }],
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
    logSafeError("GET /api/admin/supplier-products failed", error);
    return NextResponse.json({ success: false, error: "Unable to load supplier products." }, { status: 500 });
  }
}
