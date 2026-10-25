import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { SupplierStatus } from "@prisma/client";
import { supplierStatusSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import {
  isPrismaErrorCode,
  logSafeError,
  requireAdminActor,
} from "@/lib/dropshipping/http";
import { KENYA_COUNTIES } from "@/lib/constants";

/** Explicit supplier approval lifecycle. A status change is never a no-op. */
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED", "REJECTED"],
  SUSPENDED: ["APPROVED", "REJECTED"],
  REJECTED: ["PENDING"],
};

const termsSchema = z.object({
  legalName: z.string().trim().min(2).max(200).optional(),
  registrationNumber: z.string().trim().min(2).max(120).optional(),
  kraPin: z.string().trim().max(64).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email().max(254).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  physicalAddress: z.string().trim().max(500).optional(),
  deliveryCounties: z.array(z.enum(KENYA_COUNTIES)).max(47).optional(),
  dispatchEstimateMinDays: z.number().int().min(0).max(365).nullable().optional(),
  dispatchEstimateMaxDays: z.number().int().min(0).max(365).nullable().optional(),
  deliveryEstimateMinDays: z.number().int().min(0).max(365).nullable().optional(),
  deliveryEstimateMaxDays: z.number().int().min(0).max(365).nullable().optional(),
  returnTerms: z.string().trim().min(4).max(2000).optional(),
  paymentTerms: z.string().trim().min(4).max(2000).optional(),
  paymentResponsibility: z.enum(["UNDEFINED", "SELLER", "PLATFORM", "SUPPLIER_CREDIT"]).optional(),
  commercialTermsVerified: z.boolean().optional(),
  commercialTermsNote: z.string().trim().max(2000).optional(),
  verificationNotes: z.string().trim().max(2000).optional(),
});

type SupplierRow = {
  id: string;
  status: string;
  legalName: string | null;
  registrationNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  deliveryCounties: string[];
  paymentResponsibility: string;
  paymentTerms: string | null;
  returnTerms: string | null;
  commercialTermsVerifiedAt: Date | null;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier id." }, { status: 400 });
  }
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, region: true, countryCode: true, status: true,
        legalName: true, registrationNumber: true, kraPin: true, contactName: true,
        contactEmail: true, contactPhone: true, physicalAddress: true, websiteUrl: true,
        notes: true, verificationNotes: true, approvedAt: true, submittedAt: true,
        statusChangedAt: true, statusReason: true, deliveryCounties: true,
        dispatchEstimateMinDays: true, dispatchEstimateMaxDays: true,
        deliveryEstimateMinDays: true, deliveryEstimateMaxDays: true, returnTerms: true,
        paymentTerms: true, paymentResponsibility: true, commercialTermsVerifiedAt: true,
        commercialTermsNote: true, createdAt: true, updatedAt: true,
        _count: { select: { products: true } },
      },
    });
    if (!supplier) return NextResponse.json({ success: false, error: "Supplier not found." }, { status: 404 });
    return NextResponse.json({ success: true, data: supplier });
  } catch (error) {
    logSafeError("GET /api/admin/suppliers/[id] failed", error);
    return NextResponse.json({ success: false, error: "Unable to load supplier." }, { status: 500 });
  }
}

/** Records or updates the manually verified business/commercial terms. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier id." }, { status: 400 });
  }
  const parsed = termsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid supplier terms." }, { status: 400 });
  }
  const { commercialTermsVerified, ...fields } = parsed.data;
  try {
    const data = await prisma.supplier.update({
      where: { id },
      data: {
        ...fields,
        commercialTermsVerifiedAt: commercialTermsVerified ? new Date() : undefined,
      },
      select: { id: true, status: true, paymentResponsibility: true, commercialTermsVerifiedAt: true },
    });
    await logAuditEvent({
      action: "supplier.terms_updated",
      actorId: guard.actor.id,
      actorEmail: guard.actor.email,
      targetType: "supplier",
      targetId: id,
      metadata: { termsVerified: commercialTermsVerified === true, fields: Object.keys(fields).length },
    }).catch(() => undefined);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2025")) {
      return NextResponse.json({ success: false, error: "Supplier not found." }, { status: 404 });
    }
    logSafeError("PUT /api/admin/suppliers/[id] failed", error);
    return NextResponse.json({ success: false, error: "Unable to update supplier terms." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier id." }, { status: 400 });
  }
  const parsed = supplierStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid supplier status or reason." }, { status: 400 });
  }

  try {
    const supplier = (await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true, status: true, legalName: true, registrationNumber: true,
        contactEmail: true, contactPhone: true, deliveryCounties: true,
        paymentResponsibility: true, paymentTerms: true, returnTerms: true,
        commercialTermsVerifiedAt: true,
      },
    })) as SupplierRow | null;
    if (!supplier) return NextResponse.json({ success: false, error: "Supplier not found." }, { status: 404 });

    const to = parsed.data.status;
    if (!STATUS_TRANSITIONS[supplier.status]?.includes(to)) {
      return NextResponse.json(
        { success: false, error: `A ${supplier.status.toLowerCase()} supplier cannot become ${to.toLowerCase()}.` },
        { status: 409 },
      );
    }

    // Manual business verification gate. The response names the missing
    // requirement categories but never echoes the confidential values.
    const missing: string[] = [];
    if (to === "APPROVED") {
      if (!supplier.legalName) missing.push("legal business name");
      if (!supplier.registrationNumber) missing.push("registration number");
      if (!supplier.contactEmail || !supplier.contactPhone) missing.push("verified contact details");
      if (supplier.deliveryCounties.length === 0) missing.push("delivery locations");
      if (supplier.paymentResponsibility === "UNDEFINED") missing.push("supplier payment responsibility");
      if (!supplier.paymentTerms) missing.push("payment terms");
      if (!supplier.returnTerms) missing.push("return terms");
      if (!supplier.commercialTermsVerifiedAt) missing.push("commercial-terms verification");
      if (missing.length > 0) {
        return NextResponse.json(
          { success: false, error: "Complete manual verification before approval.", missing },
          { status: 422 },
        );
      }
    }

    const now = new Date();
    const claimed = await prisma.supplier.updateMany({
      where: { id, status: supplier.status as SupplierStatus },
      data: {
        status: to as SupplierStatus,
        statusReason: parsed.data.reason,
        statusChangedAt: now,
        approvedAt: to === "APPROVED" ? now : null,
        verifiedById: to === "APPROVED" ? guard.actor.id : undefined,
      },
    });
    if (claimed.count !== 1) {
      return NextResponse.json(
        { success: false, error: "Supplier status changed concurrently. Reload and try again." },
        { status: 409 },
      );
    }
    await logAuditEvent({
      action: "supplier.status_changed",
      actorId: guard.actor.id,
      actorEmail: guard.actor.email,
      targetType: "supplier",
      targetId: id,
      metadata: { from: supplier.status, to, reasonProvided: true },
    }).catch(() => undefined);
    return NextResponse.json({ success: true, data: { id, status: to, statusChangedAt: now } });
  } catch (error) {
    logSafeError("PATCH /api/admin/suppliers/[id] failed", error);
    return NextResponse.json({ success: false, error: "Unable to update supplier." }, { status: 500 });
  }
}
