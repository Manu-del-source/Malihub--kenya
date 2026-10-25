import { NextResponse, type NextRequest } from "next/server";
import { returnDecisionSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";
import { dropshippingErrorResponse } from "@/lib/dropshipping/route-errors";
import {
  afterReturnDecision,
  updateSupplierReturnStatus,
} from "@/services/dropshipping-return-service";

/** Admin-only return transition. Refund status is read from the DB, never input. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid return request id." }, { status: 400 });
  }
  const parsed = returnDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid return decision." }, { status: 400 });
  }
  const v = parsed.data;
  try {
    const result = await updateSupplierReturnStatus(prisma, {
      returnRequestId: id,
      status: v.status,
      actor: { id: guard.actor.id, email: guard.actor.email, role: "ADMIN" },
      responsibility: v.responsibility,
      returnShippingParty: v.returnShippingParty,
      resolutionNote: v.resolutionNote,
    });
    await afterReturnDecision(prisma, result, {
      id: guard.actor.id,
      email: guard.actor.email,
    }).catch((error) => logSafeError("Supplier return decision fan-out failed", error));
    return NextResponse.json({
      success: true,
      data: {
        id: result.id,
        from: result.from,
        to: result.to,
        refundId: result.refundId,
        payoutHoldActive: result.payoutHoldActive,
        message:
          "The return status was updated. No refund or payout was released automatically.",
      },
    });
  } catch (error) {
    return dropshippingErrorResponse(error, "PATCH /api/admin/supplier-returns/[id] failed");
  }
}
