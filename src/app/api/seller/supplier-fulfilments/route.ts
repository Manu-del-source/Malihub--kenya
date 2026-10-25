import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierFulfilmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logSafeError, requireActiveActor, requireVerifiedSeller } from "@/lib/dropshipping/http";
import { SELLER_FULFILMENT_SELECT } from "@/lib/dropshipping/selects";

const STATUSES: SupplierFulfilmentStatus[] = [
  "AWAITING_PAYMENT", "AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED",
  "DISPATCHED", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELLED",
];

/** Seller's own supplier fulfilment queue; no other seller's costs are visible. */
export async function GET(request: NextRequest) {
  const guard = await requireActiveActor();
  if (!guard.ok) return guard.response;
  const seller = await requireVerifiedSeller(prisma, guard.actor);
  if (seller instanceof NextResponse) return seller;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const overdue = params.get("overdue") === "true";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20));
  const where: Prisma.SupplierFulfilmentWhereInput = {
    sellerId: seller.id,
    ...(status && STATUSES.includes(status as SupplierFulfilmentStatus)
      ? { status: status as SupplierFulfilmentStatus }
      : {}),
    ...(overdue
      ? {
          expectedDispatchAt: { lt: new Date() },
          status: { in: ["AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED"] },
        }
      : {}),
  };

  try {
    const [total, data] = await Promise.all([
      prisma.supplierFulfilment.count({ where }),
      prisma.supplierFulfilment.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: SELLER_FULFILMENT_SELECT,
      }),
    ]);
    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logSafeError("GET /api/seller/supplier-fulfilments failed", error);
    return NextResponse.json({ success: false, error: "Unable to load supplier orders." }, { status: 500 });
  }
}
