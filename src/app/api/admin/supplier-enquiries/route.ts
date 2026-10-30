import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierLeadStatus } from "@prisma/client";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "NEGOTIATING", "VERIFICATION_PENDING", "ONBOARDED", "DECLINED"] as const;

export async function GET(request: NextRequest) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "25", 10) || 25));
  const where: Prisma.SupplierLeadWhereInput = status && statuses.includes(status as (typeof statuses)[number])
    ? { status: status as SupplierLeadStatus }
    : {};
  try {
    const [total, data, counts] = await Promise.all([
      prisma.supplierLead.count({ where }),
      prisma.supplierLead.findMany({
        where, orderBy: [{ followUpAt: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit, take: limit,
        select: {
          id: true, companyName: true, contactName: true, email: true, phone: true,
          location: true, categories: true, catalogueUrl: true, websiteUrl: true,
          message: true, status: true, internalNotes: true, wholesaleTerms: true,
          deliveryTerms: true, followUpAt: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.supplierLead.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    return NextResponse.json({
      success: true, data,
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logSafeError("GET /api/admin/supplier-enquiries failed", error);
    return NextResponse.json({ success: false, error: "Unable to load supplier enquiries." }, { status: 500 });
  }
}

