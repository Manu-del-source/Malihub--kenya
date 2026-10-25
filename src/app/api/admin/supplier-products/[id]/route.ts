import { NextResponse, type NextRequest } from "next/server";
import type { SupplierProductStatus } from "@prisma/client";
import { supplierProductDecisionSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";
import { ADMIN_SUPPLIER_PRODUCT_SELECT } from "@/lib/dropshipping/selects";

const DECISION_TARGET: Record<string, SupplierProductStatus> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  SUSPEND: "SUSPENDED",
  REMOVE: "REMOVED",
  RESUBMIT: "PENDING_REVIEW",
};

const ALLOWED_FROM: Record<string, SupplierProductStatus[]> = {
  APPROVE: ["DRAFT", "PENDING_REVIEW", "REJECTED", "SUSPENDED"],
  REJECT: ["DRAFT", "PENDING_REVIEW", "APPROVED", "SUSPENDED"],
  SUSPEND: ["APPROVED"],
  REMOVE: ["APPROVED", "SUSPENDED", "REJECTED", "DRAFT", "PENDING_REVIEW"],
  RESUBMIT: ["REJECTED", "SUSPENDED"],
};

const AUDIT_ACTION = {
  APPROVE: "supplier_product.approved",
  REJECT: "supplier_product.rejected",
  SUSPEND: "supplier_product.suspended",
  REMOVE: "supplier_product.removed",
  RESUBMIT: "supplier_product.submitted",
} as const;

type ProductRow = {
  id: string;
  approvalStatus: string;
  isActive: boolean;
  stockVerifiedAt: Date | null;
  costVerifiedAt: Date | null;
  deliveryChargeVerifiedAt: Date | null;
  supplier: { status: string };
};

/**
 * Admin product review. Approval requires an approved supplier AND a recorded
 * stock/cost/delivery verification: submitting data alone never publishes it.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier product id." }, { status: 400 });
  }
  const parsed = supplierProductDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid decision or note." }, { status: 400 });
  }
  const { decision, note } = parsed.data;
  const to = DECISION_TARGET[decision];

  try {
    const product = (await prisma.supplierProduct.findUnique({
      where: { id },
      select: {
        id: true, approvalStatus: true, isActive: true, stockVerifiedAt: true,
        costVerifiedAt: true, deliveryChargeVerifiedAt: true,
        supplier: { select: { status: true } },
      },
    })) as ProductRow | null;
    if (!product) return NextResponse.json({ success: false, error: "Supplier product not found." }, { status: 404 });
    const allowedFrom = ALLOWED_FROM[decision] ?? [];
    if (!allowedFrom.includes(product.approvalStatus as SupplierProductStatus)) {
      return NextResponse.json(
        { success: false, error: `A ${product.approvalStatus.toLowerCase()} product cannot be ${decision.toLowerCase()}d.` },
        { status: 409 },
      );
    }
    const missing: string[] = [];
    if (decision === "APPROVE") {
      if (product.supplier.status !== "APPROVED") missing.push("approved supplier");
      if (!product.stockVerifiedAt) missing.push("stock verification");
      if (!product.costVerifiedAt) missing.push("cost verification");
      if (!product.deliveryChargeVerifiedAt) missing.push("delivery-charge verification");
      if (missing.length > 0) {
        return NextResponse.json(
          { success: false, error: "Complete verification before approving this product.", missing },
          { status: 422 },
        );
      }
    }

    const now = new Date();
    const claimed = await prisma.supplierProduct.updateMany({
      where: { id, approvalStatus: product.approvalStatus as SupplierProductStatus },
      data: {
        approvalStatus: to,
        reviewedAt: now,
        reviewedById: guard.actor.id,
        reviewNote: note,
        isActive: decision === "REMOVE" ? false : decision === "APPROVE" ? true : product.isActive,
        removedAt: decision === "REMOVE" ? now : null,
        submittedAt: decision === "RESUBMIT" ? now : undefined,
      },
    });
    if (claimed.count !== 1) {
      return NextResponse.json(
        { success: false, error: "The product changed concurrently. Reload and try again." },
        { status: 409 },
      );
    }
    await logAuditEvent({
      action: AUDIT_ACTION[decision],
      actorId: guard.actor.id,
      actorEmail: guard.actor.email,
      targetType: "supplier_product",
      targetId: id,
      metadata: { from: product.approvalStatus, to, noteProvided: true },
    }).catch(() => undefined);

    const data = await prisma.supplierProduct.findUnique({
      where: { id },
      select: ADMIN_SUPPLIER_PRODUCT_SELECT,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logSafeError("PATCH /api/admin/supplier-products/[id] failed", error);
    return NextResponse.json({ success: false, error: "Unable to update supplier product." }, { status: 500 });
  }
}
