"use server";

import { revalidatePath } from "next/cache";
import { requireSellerAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  markOrderFulfilled,
  OrderTransitionError,
  type FulfillmentStep,
} from "@/services/order-transition-service";

/**
 * Seller fulfilment is deliberately limited to SHIPPED and DELIVERED.
 * Payment status is provider-owned; sellers cannot mark an order paid,
 * pending, cancelled, completed or refunded from this action.
 */
export async function updateSellerOrderFulfilment(input: {
  orderId: string;
  step: FulfillmentStep;
  shipment?: { carrierName: string; trackingNumber: string; trackingUrl?: string };
}): Promise<{ success: boolean; status?: string; error?: string }> {
  if (
    !input ||
    typeof input.orderId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.orderId) ||
    (input.step !== "SHIPPED" && input.step !== "DELIVERED") ||
    (input.step === "SHIPPED" &&
      (!input.shipment ||
        typeof input.shipment.carrierName !== "string" ||
        typeof input.shipment.trackingNumber !== "string" ||
        input.shipment.carrierName.trim().length === 0 ||
        input.shipment.carrierName.trim().length > 80 ||
        input.shipment.trackingNumber.trim().length === 0 ||
        input.shipment.trackingNumber.trim().length > 100 ||
        (input.shipment.trackingUrl !== undefined &&
          typeof input.shipment.trackingUrl !== "string")))
  ) {
    return { success: false, error: "Invalid order update." };
  }

  const { user } = await requireSellerAccess();
  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true, verificationStatus: true },
  });

  if (!seller || seller.verificationStatus !== "VERIFIED") {
    return { success: false, error: "Only verified sellers can update order fulfilment." };
  }

  try {
    const result = await markOrderFulfilled(prisma, input.step, {
      orderId: input.orderId,
      actorUserId: user.id,
      actorSellerId: seller.id,
      ...(input.step === "SHIPPED" ? { shipment: input.shipment } : {}),
    });

    revalidatePath("/seller");
    revalidatePath("/seller/orders");
    revalidatePath("/buyer/orders");
    return { success: true, status: result.order.status };
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Could not update this order. Please refresh and try again." };
  }
}
