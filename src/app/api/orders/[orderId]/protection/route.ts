import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { logAuditEvent } from "@/services/audit-service";

const reasons = new Set([
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCRIBED",
  "DAMAGED_ITEM",
  "WRONG_ITEM",
  "OTHER",
]);

/**
 * Buyer-owned dispute intake. This records a claim for review; it does not
 * issue a refund, change payment state, or assert that funds are held.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const { orderId } = await context.params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!reasons.has(reason) || description.length < 20 || description.length > 4000) {
    return NextResponse.json(
      { success: false, error: "Choose a valid reason and provide a description of 20–4000 characters." },
      { status: 400 },
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: user.id },
    select: { id: true, orderNumber: true, status: true, deliveredAt: true, inspectionEndsAt: true },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }
  if (!["PAID", "CONFIRMED", "SHIPPED", "DELIVERED"].includes(order.status)) {
    return NextResponse.json(
      { success: false, error: "A protection case can only be opened for an active paid order." },
      { status: 409 },
    );
  }

  // If an inspection window exists and has elapsed, a case needs staff review
  // rather than silently creating a new automatic payout block.
  if (order.inspectionEndsAt && order.inspectionEndsAt < new Date()) {
    return NextResponse.json(
      { success: false, error: "The inspection window has ended. Contact MaliHub support for review." },
      { status: 409 },
    );
  }

  try {
    const protectionCase = await prisma.buyerProtectionCase.create({
      data: {
        orderId: order.id,
        buyerId: user.id,
        reason: reason as never,
        description,
      },
      select: { id: true, orderId: true, reason: true, status: true, openedAt: true },
    });

    await logAuditEvent({
      action: "protection.case_opened" as never,
      actorId: user.id,
      targetType: "buyer_protection_case",
      targetId: protectionCase.id,
      metadata: { orderNumber: order.orderNumber, reason },
    });

    return NextResponse.json({
      success: true,
      data: protectionCase,
      message: "Your case has been submitted for review. This does not automatically issue a refund.",
    }, { status: 201 });
  } catch (error) {
    // The schema intentionally permits one case per order. A duplicate is
    // returned as a conflict instead of leaking a database error.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { success: false, error: "A protection case already exists for this order." },
        { status: 409 },
      );
    }
    console.error("POST order protection case failed", error);
    return NextResponse.json({ success: false, error: "Unable to submit your case right now." }, { status: 500 });
  }
}
