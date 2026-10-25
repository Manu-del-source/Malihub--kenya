import { NextResponse, type NextRequest } from "next/server";
import { returnRequestSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { requireActiveActor } from "@/lib/dropshipping/http";
import { dropshippingErrorResponse } from "@/lib/dropshipping/route-errors";
import {
  afterReturnRequestCreated,
  createSupplierReturnRequest,
} from "@/services/dropshipping-return-service";
import { logSafeError } from "@/lib/dropshipping/http";

/** Buyer cancel/return/dispute request. Ownership is checked in the service. */
export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireActiveActor();
  if (!guard.ok) return guard.response;

  const parsed = returnRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid return request", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const v = parsed.data;
  try {
    const result = await createSupplierReturnRequest(prisma, {
      fulfilmentId: v.fulfilmentId,
      buyerId: guard.actor.id,
      reason: v.reason,
      reasonNote: v.reasonNote,
      evidenceNote: v.evidenceNote,
      idempotencyKey: v.idempotencyKey,
    });
    await afterReturnRequestCreated(prisma, result).catch((error) =>
      logSafeError("Supplier return fan-out failed", error),
    );
    return NextResponse.json(
      {
        success: true,
        data: {
          id: result.id,
          status: result.status,
          protectionCaseId: result.protectionCaseId,
          idempotent: result.idempotent,
          message:
            "Your request was received. An administrator will review it before any refund, return or payout decision.",
        },
      },
      { status: result.idempotent ? 200 : 201 },
    );
  } catch (error) {
    return dropshippingErrorResponse(error, "POST /api/buyer/supplier-returns failed");
  }
}
