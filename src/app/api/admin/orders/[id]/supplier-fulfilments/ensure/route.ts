import { NextResponse, type NextRequest } from "next/server";
import { uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { requireAdminActor } from "@/lib/dropshipping/http";
import { dropshippingErrorResponse } from "@/lib/dropshipping/route-errors";
import { ensureSupplierFulfilmentsForPaidOrder } from "@/services/dropshipping-fulfilment-service";

/**
 * Manual recovery for a paid order whose post-payment task fan-out failed.
 * Idempotent: one task per supplier-sourced order item, keyed by orderItemId.
 * Admin-only, same-origin, audited; never changes payment or order status.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
  }
  try {
    const result = await ensureSupplierFulfilmentsForPaidOrder(prisma, id);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return dropshippingErrorResponse(error, "POST /api/admin/orders/[id]/supplier-fulfilments/ensure failed");
  }
}
