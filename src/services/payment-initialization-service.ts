import "server-only";

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { isAcceptedDeliveryPayable } from "@/lib/delivery-payment-state";
import { addMoneyCents, isMoneyCents } from "@/lib/money";
import { lockDeliveryOrder } from "@/modules/orders/delivery-quote-service";
import { MAX_PAYMENT_ATTEMPTS_PER_ORDER } from "@/services/payment-service";

export type InitializationStore = Pick<PrismaClient, "order" | "orderItem" | "payment" | "$transaction">;

export class PaymentInitializationError extends Error {
  constructor(message: string, readonly code: "not_found" | "not_payable" | "delivery_not_accepted" | "delivery_changed" | "invalid_amount" | "payment_initializing" | "payment_requires_review" | "attempt_limit") {
    super(message);
    this.name = "PaymentInitializationError";
  }
}

type Reservation =
  | { kind: "reused"; accessCode: string; reference: string }
  | { kind: "reserved"; paymentId: string; reference: string; amountCents: number; orderNumber: string };

/**
 * Reserve BEFORE contacting Paystack. The common order-keyed advisory lock
 * serializes reservations, quote writes/acceptance, settlement and buyer
 * cancellation. An ambiguous provider timeout keeps its reservation locked
 * against new charges until reconciled; quotes remain locked after any
 * attempt because this integration cannot revoke a previously issued checkout.
 */
export async function reservePaystackPayment(
  db: InitializationStore, params: { userId: string; orderId: string; quoteVersion: number }
): Promise<Reservation> {
  return db.$transaction(async (tx) => {
    await lockDeliveryOrder(tx, params.orderId);
    const order = await tx.order.findFirst({
      where: { id: params.orderId, buyerId: params.userId },
      select: {
        id: true, orderNumber: true, status: true, subtotalCents: true, totalCents: true,
        deliveryEstimateCents: true, deliveryFeeCents: true, deliveryFeeStatus: true,
        deliveryFeeAcceptedAt: true, deliveryQuoteCents: true, deliveryQuoteUpdatedAt: true, deliveryQuoteVersion: true,
      },
    });
    if (!order) throw new PaymentInitializationError("Order not found.", "not_found");
    if (order.status !== "PENDING") throw new PaymentInitializationError("This order is not awaiting payment.", "not_payable");
    if (!Number.isInteger(params.quoteVersion) || params.quoteVersion !== order.deliveryQuoteVersion) {
      throw new PaymentInitializationError("Delivery details changed. Refresh and review the latest quote before paying.", "delivery_changed");
    }
    if (!isAcceptedDeliveryPayable(order)) {
      throw new PaymentInitializationError("Review and accept the current delivery quote before paying, or contact support if no estimate is recorded.", "delivery_not_accepted");
    }
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id }, select: { quantity: true, unitPriceCents: true, totalCents: true },
    });
    let subtotal = 0;
    if (items.length === 0) throw new PaymentInitializationError("The order total could not be verified. Please contact support.", "invalid_amount");
    for (const item of items) {
      const line = item.unitPriceCents * item.quantity;
      const next = addMoneyCents(subtotal, line);
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !isMoneyCents(item.unitPriceCents) ||
          item.unitPriceCents === 0 || line !== item.totalCents || next === null) {
        throw new PaymentInitializationError("The order total could not be verified. Please contact support.", "invalid_amount");
      }
      subtotal = next;
    }
    if (subtotal !== order.subtotalCents) throw new PaymentInitializationError("The order total could not be verified. Please contact support.", "invalid_amount");

    const attempts = await tx.payment.findMany({
      where: { orderId: order.id }, orderBy: { createdAt: "desc" },
      select: { id: true, provider: true, status: true, amountCents: true, currency: true, customerReference: true, metadata: true },
    });
    if (attempts.some((attempt) => attempt.status === "SUCCESS")) {
      throw new PaymentInitializationError("A payment for this order has already succeeded. Check its status.", "not_payable");
    }
    const active = attempts.filter((attempt) => attempt.status === "PENDING" || attempt.status === "PROCESSING");
    if (active.length > 1) throw new PaymentInitializationError("Multiple payment attempts require support review.", "payment_initializing");
    const existing = active[0];
    if (existing) {
      // Historical orders may have older terminal attempts whose hosted
      // checkout links could still be payable. Do not resume a different
      // active reference until support has reconciled the full set.
      if (attempts.length !== 1) {
        throw new PaymentInitializationError("Multiple payment attempts require support review before continuing.", "payment_requires_review");
      }
      if (existing.provider !== "PAYSTACK" || existing.amountCents !== order.totalCents || existing.currency !== "KES") {
        throw new PaymentInitializationError("An existing payment requires support review before continuing.", "payment_initializing");
      }
      const meta = existing.metadata as { paystack?: { accessCode?: unknown } } | null;
      if (typeof meta?.paystack?.accessCode === "string" && meta.paystack.accessCode) {
        return { kind: "reused", accessCode: meta.paystack.accessCode, reference: existing.customerReference };
      }
      throw new PaymentInitializationError("This payment is still being initialized. Check its status before trying again.", "payment_initializing");
    }
    if (attempts.length >= MAX_PAYMENT_ATTEMPTS_PER_ORDER) throw new PaymentInitializationError("Payment attempts for this order have reached the limit. Please contact support.", "attempt_limit");
    // A local FAILED/CANCELLED status does not revoke a hosted checkout. Until
    // the integration can prove that an old link is no longer payable, do not
    // create a second provider reference after any terminal attempt.
    if (attempts.length > 0) throw new PaymentInitializationError(
      "A previous payment needs support review before another checkout can be started.", "payment_requires_review"
    );
    const reference = `MH-${randomUUID().replace(/-/g, "")}`;
    const payment = await tx.payment.create({
      data: {
        orderId: order.id, provider: "PAYSTACK", method: "MOBILE_MONEY", status: "PENDING",
        amountCents: order.totalCents, currency: "KES", customerReference: reference,
        retryCount: attempts.length, metadata: { paystack: { initialization: "pending" } },
      }, select: { id: true },
    });
    return { kind: "reserved", paymentId: payment.id, reference, amountCents: order.totalCents, orderNumber: order.orderNumber };
  });
}
