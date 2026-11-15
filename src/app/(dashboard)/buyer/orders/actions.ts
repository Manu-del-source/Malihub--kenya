"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  markOrderFulfilled,
  OrderTransitionError,
} from "@/services/order-transition-service";

export async function confirmBuyerOrderReceipt(
  orderId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  if (
    typeof orderId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)
  ) {
    return { success: false, error: "Invalid order reference." };
  }

  const { user } = await requireUser();

  try {
    const result = await markOrderFulfilled(prisma, "COMPLETED", {
      orderId,
      actorUserId: user.id,
    });

    revalidatePath(`/buyer/orders/${orderId}`);
    revalidatePath("/buyer/orders");
    revalidatePath("/seller/orders");
    revalidatePath("/admin/orders");
    return { success: true, status: result.order.status };
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Could not confirm receipt. Please refresh and try again." };
  }
}
