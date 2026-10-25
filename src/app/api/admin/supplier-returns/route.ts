import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierReturnStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";

const STATUSES: SupplierReturnStatus[] = [
  "REQUESTED", "APPROVED", "REJECTED", "ITEM_RETURNED",
  "REFUND_PENDING", "RESOLVED", "CANCELLED",
];

/** Admin return/dispute queue. Evidence notes stay inside the admin boundary. */
export async function GET(request: NextRequest) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20));
  const where: Prisma.SupplierReturnRequestWhereInput = {
    ...(status && STATUSES.includes(status as SupplierReturnStatus)
      ? { status: status as SupplierReturnStatus }
      : {}),
  };
  try {
    const [total, data] = await Promise.all([
      prisma.supplierReturnRequest.count({ where }),
      prisma.supplierReturnRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, status: true, reason: true, reasonNote: true,
          evidenceNote: true, responsibility: true, returnShippingParty: true,
          resolutionNote: true, requestedAt: true, refundPendingAt: true,
          resolvedAt: true, refundId: true, protectionCaseId: true,
          order: { select: { id: true, orderNumber: true, status: true } },
          fulfilment: {
            select: {
              id: true, reference: true, status: true,
              supplier: { select: { name: true } },
            },
          },
          refund: { select: { id: true, status: true, amountCents: true } },
        },
      }),
    ]);
    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logSafeError("GET /api/admin/supplier-returns failed", error);
    return NextResponse.json({ success: false, error: "Unable to load return requests." }, { status: 500 });
  }
}
