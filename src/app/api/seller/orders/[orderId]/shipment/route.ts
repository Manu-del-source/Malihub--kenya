import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { logAuditEvent } from "@/services/audit-service";

/**
 * Seller can attach courier details and mark dispatch. Sellers cannot mark
 * an order delivered: delivery confirmation must come from a trusted carrier
 * integration or a separately authorized admin review.
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
  const carrierName = typeof body?.carrierName === "string" ? body.carrierName.trim() : "";
  const trackingNumber = typeof body?.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  const trackingUrl = typeof body?.trackingUrl === "string" && body.trackingUrl.trim()
    ? body.trackingUrl.trim()
    : null;

  if (
    carrierName.length < 2 || carrierName.length > 100 ||
    trackingNumber.length < 3 || trackingNumber.length > 160
  ) {
    return NextResponse.json(
      { success: false, error: "Provide a valid courier name and tracking number." },
      { status: 400 },
    );
  }
  if (trackingUrl) {
    try {
      const parsed = new URL(trackingUrl);
      if (parsed.protocol !== "https:") throw new Error("HTTPS required");
    } catch {
      return NextResponse.json(
        { success: false, error: "Tracking link must be a valid HTTPS URL." },
        { status: 400 },
      );
    }
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!seller) {
    return NextResponse.json({ success: false, error: "Seller account required." }, { status: 403 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, sellerId: seller.id },
    select: { id: true, orderNumber: true, status: true },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }
  if (!["PAID", "CONFIRMED", "SHIPPED"].includes(order.status)) {
    return NextResponse.json(
      { success: false, error: "Courier details can only be added to a paid, confirmed order." },
      { status: 409 },
    );
  }

  try {
    const shipment = await prisma.$transaction(async (tx) => {
      const existing = await tx.orderShipment.findUnique({
        where: { orderId: order.id },
        select: { id: true, status: true },
      });
      if (existing?.status === "DELIVERED") {
        throw new Error("Shipment already marked delivered; tracking cannot be reset by seller.");
      }
      const saved = await tx.orderShipment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          carrierName,
          trackingNumber,
          trackingUrl,
          status: "IN_TRANSIT",
          dispatchedAt: new Date(),
          lastEventAt: new Date(),
        },
        update: {
          carrierName,
          trackingNumber,
          trackingUrl,
          status: "IN_TRANSIT",
          dispatchedAt: new Date(),
          lastEventAt: new Date(),
        },
        select: {
          id: true, carrierName: true, trackingNumber: true, trackingUrl: true,
          status: true, dispatchedAt: true, lastEventAt: true,
        },
      });
      // Shipment metadata must not bypass the dedicated order-transition service.
      return saved;
    });

    await logAuditEvent({
      action: "protection.shipment_dispatched" as never,
      actorId: user.id,
      targetType: "order_shipment",
      targetId: shipment.id,
      metadata: { orderNumber: order.orderNumber, carrierName },
    });

    return NextResponse.json({
      success: true,
      data: shipment,
      message: "Tracking details saved. Delivery still needs trusted confirmation.",
    });
  } catch (error) {
    console.error("POST seller shipment failed", error);
    return NextResponse.json({ success: false, error: "Unable to save tracking details right now." }, { status: 500 });
  }
}
