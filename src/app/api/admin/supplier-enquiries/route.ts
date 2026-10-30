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

export async function PATCH(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => null);
  const schema = (await import("zod")).z.object({
    id: (await import("zod")).z.string().uuid(),
    status: (await import("zod")).z.enum(statuses).optional(),
    internalNotes: (await import("zod")).z.string().trim().max(4000).nullable().optional(),
    wholesaleTerms: (await import("zod")).z.string().trim().max(3000).nullable().optional(),
    deliveryTerms: (await import("zod")).z.string().trim().max(3000).nullable().optional(),
    followUpAt: (await import("zod")).z.string().datetime().nullable().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid enquiry update." }, { status: 400 });
  const { id, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) return NextResponse.json({ success: false, error: "No changes supplied." }, { status: 400 });
  try {
    const data = await prisma.supplierLead.update({
      where: { id },
      data: {
        ...fields,
        followUpAt: fields.followUpAt === undefined ? undefined : fields.followUpAt ? new Date(fields.followUpAt) : null,
      },
      select: { id: true, status: true, internalNotes: true, wholesaleTerms: true, deliveryTerms: true, followUpAt: true, updatedAt: true },
    });
    await logAuditEvent({
      action: "supplier.enquiry_updated", actorId: guard.actor.id, actorEmail: guard.actor.email,
      targetType: "supplier_enquiry", targetId: id,
      metadata: { fields: Object.keys(fields) },
    }).catch(() => undefined);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logSafeError("PATCH /api/admin/supplier-enquiries failed", error);
    return NextResponse.json({ success: false, error: "Unable to update supplier enquiry." }, { status: 500 });
  }
}
