import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierFulfilmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";
import { ADMIN_FULFILMENT_SELECT } from "@/lib/dropshipping/selects";

const STATUSES: SupplierFulfilmentStatus[] = [
  "AWAITING_PAYMENT", "AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED",
  "DISPATCHED", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELLED",
];

/** Admin exception queue: statuses, overdue dispatch, unresolved returns. */
export async function GET(request: NextRequest) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const overdue = params.get("overdue") === "true";
  const exceptions = params.get("exceptions") === "true";
  const q = params.get("q")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20));

  const filters: Prisma.SupplierFulfilmentWhereInput[] = [];
  if (status && STATUSES.includes(status as SupplierFulfilmentStatus)) {
    filters.push({ status: status as SupplierFulfilmentStatus });
  }
  if (overdue) {
    filters.push({
      expectedDispatchAt: { lt: new Date() },
      status: { in: ["AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED"] },
    });
  }
  if (exceptions) {
    filters.push({
      OR: [
        { status: "FAILED" },
        { returnRequest: { status: { in: ["REQUESTED", "APPROVED", "ITEM_RETURNED", "REFUND_PENDING"] } } },
        { purchase: { status: { in: ["FAILED", "CANCELLED"] } } },
      ],
    });
  }
  if (q) filters.push({ reference: { contains: q, mode: "insensitive" } });
  const where: Prisma.SupplierFulfilmentWhereInput = filters.length > 0 ? { AND: filters } : {};

  try {
    const [total, data] = await Promise.all([
      prisma.supplierFulfilment.count({ where }),
      prisma.supplierFulfilment.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: ADMIN_FULFILMENT_SELECT,
      }),
    ]);
    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logSafeError("GET /api/admin/supplier-fulfilments failed", error);
    return NextResponse.json({ success: false, error: "Unable to load supplier orders." }, { status: 500 });
  }
}
