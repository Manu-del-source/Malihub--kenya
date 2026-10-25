import { NextResponse, type NextRequest } from "next/server";
import { fulfilmentUpdateSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { isAdministratorRole } from "@/lib/auth";
import {
  logSafeError,
  requireActiveActor,
  requireVerifiedSeller,
} from "@/lib/dropshipping/http";
import { dropshippingErrorResponse } from "@/lib/dropshipping/route-errors";
import {
  afterSupplierFulfilmentTransition,
  transitionSupplierFulfilment,
} from "@/services/dropshipping-fulfilment-service";

/**
 * Authorized supplier-fulfilment state changes. Seller ownership is checked
 * inside the service against the persisted order; admins can record a
 * reviewed delivery, cancellation or retry. Idempotency keys make a retried
 * request converge on the same event instead of creating a second status.
 */
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
  const parsed = fulfilmentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid action", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const v = parsed.data;

  try {
    const result = await transitionSupplierFulfilment(prisma, {
      fulfilmentId: id,
      action: v.action,
      actor: { id: guard.actor.id, email: guard.actor.email, role: actorRole },
      finalUnitCostMinor: v.finalUnitCostMinor,
      supplierReference: v.supplierReference,
      purchaseReference: v.purchaseReference,
      carrierName: v.carrierName,
      trackingNumber: v.trackingNumber,
      trackingUrl: v.trackingUrl,
      deliveryEvidenceNote: v.deliveryEvidenceNote,
      reason: v.reason,
      idempotencyKey: v.idempotencyKey,
    });
    await afterSupplierFulfilmentTransition(prisma, result, {
      id: guard.actor.id,
      email: guard.actor.email,
      role: actorRole,
    }).catch((error) => logSafeError("Supplier fulfilment fan-out failed", error));
    return NextResponse.json({
      success: true,
      data: {
        id: result.id,
        reference: result.reference,
        from: result.from,
        to: result.to,
        idempotent: result.idempotent,
        statusLabel: result.to,
      },
    });
  } catch (error) {
    return dropshippingErrorResponse(error, "POST /api/supplier-fulfilments/[id]/transition failed");
  }
}
