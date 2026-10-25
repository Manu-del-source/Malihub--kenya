import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, SupplierStatus } from "@prisma/client";
import { supplierCreateSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import {
  isPrismaErrorCode,
  logSafeError,
  requireAdminActor,
} from "@/lib/dropshipping/http";
import { ADMIN_SUPPLIER_SELECT } from "@/lib/dropshipping/selects";

/**
 * Admin-only supplier registry. Creating a supplier ALWAYS starts PENDING;
 * there is no public registration endpoint and no supplier-provided status.
 * Business identifiers and contact details are returned only to administrators.
 */

export async function GET(request: NextRequest) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const q = params.get("q")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20));
  const where: Prisma.SupplierWhereInput = {
    ...(status && ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)
      ? { status: status as SupplierStatus }
      : {}),
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
      : {}),
  };

  try {
    const [total, data] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: ADMIN_SUPPLIER_SELECT,
      }),
    ]);
    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    logSafeError("GET /api/admin/suppliers failed", error);
    return NextResponse.json({ success: false, error: "Unable to load suppliers." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = supplierCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const v = parsed.data;
  const emptyToNull = (value?: string) => (value && value.length > 0 ? value : null);

  try {
    const data = await prisma.supplier.create({
      data: {
        name: v.name,
        slug: v.slug,
        region: v.region,
        countryCode: v.countryCode,
        status: "PENDING",
        legalName: emptyToNull(v.legalName),
        registrationNumber: emptyToNull(v.registrationNumber),
        kraPin: emptyToNull(v.kraPin),
        contactName: emptyToNull(v.contactName),
        contactEmail: emptyToNull(v.contactEmail),
        contactPhone: emptyToNull(v.contactPhone),
        physicalAddress: emptyToNull(v.physicalAddress),
        websiteUrl: emptyToNull(v.websiteUrl),
        notes: emptyToNull(v.notes),
        verificationNotes: emptyToNull(v.verificationNotes),
        deliveryCounties: v.deliveryCounties,
        dispatchEstimateMinDays: v.dispatchEstimateMinDays ?? null,
        dispatchEstimateMaxDays: v.dispatchEstimateMaxDays ?? null,
        deliveryEstimateMinDays: v.deliveryEstimateMinDays ?? null,
        deliveryEstimateMaxDays: v.deliveryEstimateMaxDays ?? null,
        returnTerms: emptyToNull(v.returnTerms),
        paymentTerms: emptyToNull(v.paymentTerms),
        paymentResponsibility: v.paymentResponsibility,
        commercialTermsNote: emptyToNull(v.commercialTermsNote),
        submittedAt: new Date(),
        statusChangedAt: new Date(),
      },
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
    });
    await logAuditEvent({
      action: "supplier.created",
      actorId: guard.actor.id,
      actorEmail: guard.actor.email,
      targetType: "supplier",
      targetId: data.id,
      metadata: { status: "PENDING", region: v.region },
    }).catch(() => undefined);
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ success: false, error: "Supplier slug already exists." }, { status: 409 });
    }
    logSafeError("POST /api/admin/suppliers failed", error);
    return NextResponse.json({ success: false, error: "Unable to create supplier." }, { status: 500 });
  }
}
