import { NextResponse, type NextRequest } from "next/server";
import { purchaseConfirmationSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { isAdministratorRole } from "@/lib/auth";
import { requireActiveActor, requireVerifiedSeller } from "@/lib/dropshipping/http";
import { dropshippingErrorResponse } from "@/lib/dropshipping/route-errors";
import {
  afterSupplierPurchaseAction,
  handleSupplierPurchaseAction,
} from "@/services/dropshipping-purchase-service";

/** Manual supplier purchase confirmation/failure/reconciliation. No money moves. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireActiveActor();
  if (!guard.ok) return guard.response;

  const actorRole = isAdministratorRole(guard.actor.role) ? "ADMIN" : "SELLER";
  if (actorRole === "SELLER") {
    const seller = await requireVerifiedSeller(prisma, guard.actor);
    if (seller instanceof NextResponse) return seller;
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid fulfilment id." }, { status: 400 });
  }
  const parsed = purchaseConfirmationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid purchase action." }, { status: 400 });
  }
  const v = parsed.data;

  try {
    const result = await handleSupplierPurchaseAction(prisma, {
      fulfilmentId: id,
      action: v.action,
      actor: { id: guard.actor.id, email: guard.actor.email, role: actorRole },
      paymentReference: v.paymentReference,
      purchaseReference: v.purchaseReference,
      reason: v.reason,
      refundAmountMinor: v.refundAmountMinor,
      reconciliationNote: v.reconciliationNote,
    });
    await afterSupplierPurchaseAction(result, {
      id: guard.actor.id,
      email: guard.actor.email,
    });
    // Never return internal fan-out fields or supplier-private references.
    return NextResponse.json({
      success: true,
      data: {
        id: result.id,
        status: result.status,
        amountMinor: result.amountMinor,
        currency: result.currency,
        customerOrderTotalCents: result.customerOrderTotalCents,
        reconciliationNote: result.reconciliationNote,
        idempotent: result.idempotent,
      },
    });
  } catch (error) {
    return dropshippingErrorResponse(error, "POST /api/supplier-fulfilments/[id]/purchase failed");
  }
}
