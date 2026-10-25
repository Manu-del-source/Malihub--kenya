import "server-only";

import type {
  Prisma,
  PrismaClient,
  SupplierFulfilmentStatus,
  SupplierPaymentResponsibility,
} from "@prisma/client";
import { logAuditEvent } from "@/services/audit-service";
import { safeNotifyUser, notifyAdministrators } from "@/services/dropshipping-notifications";
import {
  assertSupplierFulfilmentTransition,
  BUYER_FULFILMENT_MESSAGE,
  SUPPLIER_FULFILMENT_LABEL,
} from "@/lib/dropshipping/fulfilment-state-machine";
import {
  supplierFulfilmentEventIdempotencyKey,
  supplierFulfilmentIdempotencyKey,
  supplierFulfilmentReference,
  supplierPurchaseIdempotencyKey,
  supplierPurchaseReference,
} from "@/lib/dropshipping/ids";
import { isPrismaErrorCode, logSafeError } from "@/lib/dropshipping/http";
import { uuidSchema } from "@/lib/validations/dropshipping";

export type SupplierFulfilmentStore = Pick<
  PrismaClient,
  | "supplierFulfilment"
  | "supplierFulfilmentEvent"
  | "supplierPurchase"
  | "supplierProduct"
  | "order"
  | "orderItem"
  | "orderShipment"
  | "payment"
  | "seller"
  | "user"
  | "$transaction"
>;

export class SupplierFulfilmentError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "SupplierFulfilmentError";
    this.code = code;
    this.status = status;
  }
}

export type SupplierTransitionInput = {
  fulfilmentId: string;
  action:
    | "CONFIRM_AVAILABILITY"
    | "RECORD_PURCHASE"
    | "RECORD_DISPATCH"
    | "RECORD_IN_TRANSIT"
    | "RECORD_DELIVERY"
    | "REPORT_FAILURE"
    | "CANCEL"
    | "RETRY";
  actor: { id: string; email?: string | null; role: "SELLER" | "ADMIN" | "SYSTEM" };
  finalUnitCostMinor?: number;
  supplierReference?: string | null;
  purchaseReference?: string | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  deliveryEvidenceNote?: string | null;
  reason?: string | null;
  idempotencyKey?: string;
};

type FulfilmentRow = {
  id: string;
  reference: string;
  orderId: string;
  orderItemId: string;
  sellerId: string;
  supplierId: string;
  buyerId: string;
  productId: string;
  status: SupplierFulfilmentStatus;
  quantity: number;
  unitCostMinor: number;
  deliveryChargeMinor: number;
  currency: string;
  costStatus: string;
  supplierReference: string | null;
  purchaseReference: string | null;
  orderNumber: string;
  orderTotalCents: number;
  sellerUserId: string;
  supplierPaymentResponsibility: string;
  supplierPaymentTerms: string | null;
};

const ACTION_TARGET: Record<SupplierTransitionInput["action"], SupplierFulfilmentStatus> = {
  CONFIRM_AVAILABILITY: "CONFIRMED",
  RECORD_PURCHASE: "ORDERED",
  RECORD_DISPATCH: "DISPATCHED",
  RECORD_IN_TRANSIT: "IN_TRANSIT",
  RECORD_DELIVERY: "DELIVERED",
  REPORT_FAILURE: "FAILED",
  CANCEL: "CANCELLED",
  RETRY: "AWAITING_SUPPLIER_CONFIRMATION",
};

async function loadFulfilment(
  tx: Prisma.TransactionClient,
  fulfilmentId: string,
): Promise<FulfilmentRow | null> {
  const row = await tx.supplierFulfilment.findUnique({
    where: { id: fulfilmentId },
    select: {
      id: true, reference: true, orderId: true, orderItemId: true,
      sellerId: true, supplierId: true, buyerId: true, productId: true,
      status: true, quantity: true, unitCostMinor: true,
      deliveryChargeMinor: true, currency: true, costStatus: true,
      supplierReference: true, purchaseReference: true,
      order: {
        select: {
          orderNumber: true, totalCents: true,
          seller: { select: { userId: true } },
        },
      },
      supplier: {
        select: { paymentResponsibility: true, paymentTerms: true },
      },
    },
  });
  if (!row) return null;
  return {
    ...row,
    orderNumber: row.order.orderNumber,
    orderTotalCents: row.order.totalCents,
    sellerUserId: row.order.seller.userId,
    supplierPaymentResponsibility: row.supplier.paymentResponsibility,
    supplierPaymentTerms: row.supplier.paymentTerms,
  } as FulfilmentRow;
}

/**
 * Called ONLY after a provider-verified successful payment has been recorded.
 * Creates one supplier fulfilment task per supplier-sourced order item. The
 * unique `orderItemId` and deterministic event key make webhook/verify retries
 * converge on the same row; no supplier order or payment is placed here.
 */
export async function ensureSupplierFulfilmentsForPaidOrder(
  db: SupplierFulfilmentStore,
  orderId: string,
): Promise<{ created: number; skipped: number; exceptions: number }> {
  if (!uuidSchema.safeParse(orderId).success) {
    throw new SupplierFulfilmentError("Invalid order id.", "invalid_id", 400);
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, status: true, buyerId: true, sellerId: true,
      items: {
        select: {
          id: true, productId: true, quantity: true, unitPriceCents: true,
          supplierProductId: true, supplierProductTitle: true, supplierSku: true,
        },
      },
      seller: { select: { userId: true } },
    },
  });
  if (!order) throw new SupplierFulfilmentError("Order not found.", "not_found", 404);
  if (order.status !== "PAID" && order.status !== "CONFIRMED" && order.status !== "SHIPPED" && order.status !== "DELIVERED") {
    return { created: 0, skipped: 0, exceptions: 0 };
  }

  const supplierItems = order.items.filter((item) => item.supplierProductId || item.supplierProductTitle);
  let created = 0;
  let skipped = 0;
  let exceptions = 0;

  for (const [index, item] of supplierItems.entries()) {
    if (!item.supplierProductId) {
      exceptions += 1;
      await logAuditEvent({
        action: "supplier_fulfilment.creation_failed",
        actorId: null,
        targetType: "order_item",
        targetId: item.id,
        metadata: { orderId, reason: "missing_supplier_link" },
      }).catch(() => undefined);
      continue;
    }
    const existing = await db.supplierFulfilment.findUnique({
      where: { orderItemId: item.id },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const supplierProduct = await db.supplierProduct.findUnique({
      where: { id: item.supplierProductId },
      select: {
        id: true, supplierId: true, title: true, sku: true,
        costMinor: true, currency: true, deliveryChargeMinor: true,
        costStatus: true, stockStatus: true, stockVerifiedAt: true,
        supplier: { select: { id: true, status: true, dispatchEstimateMaxDays: true } },
      },
    });
    if (!supplierProduct || !supplierProduct.supplier?.id) {
      exceptions += 1;
      await logAuditEvent({
        action: "supplier_fulfilment.creation_failed",
        actorId: null,
        targetType: "order_item",
        targetId: item.id,
        metadata: { orderId, reason: "supplier_product_missing" },
      }).catch(() => undefined);
      continue;
    }

    const reference = supplierFulfilmentReference(order.orderNumber, index + 1);
    const deliveryCharge = supplierProduct.deliveryChargeMinor ?? 0;
    const unitCost = supplierProduct.costMinor;
    const totalCost = unitCost * item.quantity + deliveryCharge;
    const maxDays = supplierProduct.supplier?.dispatchEstimateMaxDays ?? null;
    const expectedDispatchAt = maxDays
      ? new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000)
      : null;

    try {
      const task = await db.supplierFulfilment.create({
        data: {
          reference,
          orderId: order.id,
          orderItemId: item.id,
          sellerId: order.sellerId,
          supplierId: supplierProduct.supplier.id,
          supplierProductId: supplierProduct.id,
          productId: item.productId,
          buyerId: order.buyerId,
          status: "AWAITING_SUPPLIER_CONFIRMATION",
          quantity: item.quantity,
          unitRetailCents: item.unitPriceCents,
          unitCostMinor: unitCost,
          currency: supplierProduct.currency,
          deliveryChargeMinor: deliveryCharge,
          totalCostMinor: totalCost,
          costStatus: supplierProduct.costStatus === "CONFIRMED" ? "CONFIRMED" : "ESTIMATED",
          expectedDispatchAt,
          lastStatusChangedAt: new Date(),
        },
        select: { id: true, reference: true },
      });
      await db.supplierFulfilmentEvent.create({
        data: {
          fulfilmentId: task.id,
          fromStatus: "AWAITING_PAYMENT",
          toStatus: "AWAITING_SUPPLIER_CONFIRMATION",
          action: "payment_confirmed",
          actorRole: "SYSTEM",
          idempotencyKey: supplierFulfilmentIdempotencyKey(item.id),
          metadata: { orderId, source: "verified_payment" },
        },
      });
      await logAuditEvent({
        action: "supplier_fulfilment.created",
        actorId: null,
        targetType: "supplier_fulfilment",
        targetId: task.id,
        metadata: { orderId, orderItemId: item.id, status: "AWAITING_SUPPLIER_CONFIRMATION" },
      }).catch(() => undefined);

      await safeNotifyUser({
        userId: order.seller.userId,
        type: "ORDER_UPDATE",
        title: `Supplier fulfilment task ${task.reference}`,
        body: "A paid order contains a supplier-sourced item. Confirm availability and the final supplier cost before recording a purchase.",
        linkUrl: `/seller/orders/${order.id}`,
        sendEmailToo: false,
      });
      await safeNotifyUser({
        userId: order.buyerId,
        type: "ORDER_UPDATE",
        title: `Order ${order.orderNumber} update`,
        body: BUYER_FULFILMENT_MESSAGE.AWAITING_SUPPLIER_CONFIRMATION,
        linkUrl: `/buyer/orders/${order.id}`,
      });
      created += 1;
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        // A concurrent verified-payment channel created the same task. This is
        // the intended idempotency outcome, not a failure.
        skipped += 1;
        continue;
      }
      exceptions += 1;
      logSafeError("Supplier fulfilment task creation failed", error);
      await logAuditEvent({
        action: "supplier_fulfilment.creation_failed",
        actorId: null,
        targetType: "order_item",
        targetId: item.id,
        metadata: { orderId, reason: "write_failed" },
      }).catch(() => undefined);
    }
  }

  if (exceptions > 0) {
    await notifyAdministrators(db, {
      title: "Supplier fulfilment tasks need attention",
      body: `${exceptions} supplier-sourced order item(s) for order ${order.orderNumber} could not be turned into fulfilment tasks. Review the exception queue.`,
      linkUrl: `/admin/dropshipping/exceptions`,
    });
  }
  return { created, skipped, exceptions };
}

async function ensurePurchaseRow(
  tx: Prisma.TransactionClient,
  fulfilment: FulfilmentRow,
): Promise<void> {
  const existing = await tx.supplierPurchase.findUnique({
    where: { fulfilmentId: fulfilment.id },
    select: { id: true },
  });
  if (existing) return;
  await tx.supplierPurchase.create({
    data: {
      fulfilmentId: fulfilment.id,
      orderId: fulfilment.orderId,
      sellerId: fulfilment.sellerId,
      supplierId: fulfilment.supplierId,
      amountMinor: fulfilment.quantity * fulfilment.unitCostMinor + fulfilment.deliveryChargeMinor,
      currency: fulfilment.currency,
      costStatus: "CONFIRMED",
      paymentResponsibility: fulfilment.supplierPaymentResponsibility as SupplierPaymentResponsibility,
      paymentTerms: fulfilment.supplierPaymentTerms,
      status: "PENDING_CONFIRMATION",
      purchaseReference: supplierPurchaseReference(fulfilment.reference),
      idempotencyKey: supplierPurchaseIdempotencyKey(fulfilment.id),
    },
  });
}

/** Applies one authorized, idempotent, audited supplier fulfilment transition. */
export async function transitionSupplierFulfilment(
  db: SupplierFulfilmentStore,
  input: SupplierTransitionInput,
): Promise<{ id: string; reference: string; from: SupplierFulfilmentStatus; to: SupplierFulfilmentStatus; idempotent: boolean }> {
  if (!uuidSchema.safeParse(input.fulfilmentId).success) {
    throw new SupplierFulfilmentError("Invalid fulfilment id.", "invalid_id", 400);
  }
  const to = ACTION_TARGET[input.action];
  const eventKey =
    input.idempotencyKey ??
    supplierFulfilmentEventIdempotencyKey(input.fulfilmentId, to, input.action);

  try {
    return await db.$transaction(async (tx) => {
      const fulfilment = await loadFulfilment(tx, input.fulfilmentId);
      if (!fulfilment) throw new SupplierFulfilmentError("Fulfilment task not found.", "not_found", 404);

      const ownsOrder = input.actor.role === "SELLER" && fulfilment.sellerUserId === input.actor.id;
      if (input.actor.role === "SELLER" && !ownsOrder) {
        throw new SupplierFulfilmentError("This task belongs to another seller.", "forbidden", 403);
      }

      const decision = assertSupplierFulfilmentTransition({
        from: fulfilment.status,
        to,
        actorRole: input.actor.role,
        ownsOrder,
        deliveryEvidenceNote: input.deliveryEvidenceNote,
        reason: input.reason,
        retryApproved: input.action === "RETRY" && input.actor.role === "ADMIN",
      });
      if (fulfilment.status === to) {
        const replay = await tx.supplierFulfilmentEvent.findUnique({
          where: { idempotencyKey: eventKey },
          select: { id: true },
        });
        if (replay) {
          return { id: fulfilment.id, reference: fulfilment.reference, from: fulfilment.status, to, idempotent: true };
        }
        const replayMessage = decision.allowed ? "Already in that state." : decision.message;
        const replayCode = decision.allowed ? "unchanged" : decision.code;
        throw new SupplierFulfilmentError(replayMessage, replayCode, 409);
      }
      if (!decision.allowed) {
        throw new SupplierFulfilmentError(decision.message, decision.code, 409);
      }

      const now = new Date();
      const data: Prisma.SupplierFulfilmentUncheckedUpdateInput = {
        status: to,
        lastStatusChangedAt: now,
      };

      switch (input.action) {
        case "CONFIRM_AVAILABILITY": {
          if (input.finalUnitCostMinor === undefined) {
            throw new SupplierFulfilmentError("Final supplier unit cost is required.", "cost_required", 400);
          }
          data.unitCostMinor = input.finalUnitCostMinor;
          data.totalCostMinor =
            input.finalUnitCostMinor * fulfilment.quantity + fulfilment.deliveryChargeMinor;
          data.costStatus = "CONFIRMED";
          data.costConfirmedAt = now;
          data.costConfirmedById = input.actor.id;
          break;
        }
        case "RECORD_PURCHASE": {
          const purchase = await tx.supplierPurchase.findUnique({
            where: { fulfilmentId: fulfilment.id },
            select: { status: true, purchaseReference: true },
          });
          if (!purchase || purchase.status !== "CONFIRMED") {
            throw new SupplierFulfilmentError(
              "Confirm the supplier purchase and payment responsibility before recording the supplier order.",
              "purchase_not_confirmed",
              409,
            );
          }
          const reference = input.supplierReference?.trim() || input.purchaseReference?.trim() || purchase.purchaseReference;
          if (!reference) throw new SupplierFulfilmentError("Supplier order reference is required.", "reference_required", 400);
          data.supplierReference = reference;
          data.purchaseReference = purchase.purchaseReference;
          break;
        }
        case "RECORD_DISPATCH": {
          if (!input.carrierName?.trim() || !input.trackingNumber?.trim()) {
            throw new SupplierFulfilmentError("Carrier and tracking number are required for dispatch.", "tracking_required", 400);
          }
          data.carrierName = input.carrierName.trim();
          data.trackingNumber = input.trackingNumber.trim();
          data.trackingUrl = input.trackingUrl?.trim() || null;
          data.dispatchedAt = now;
          break;
        }
        case "RECORD_IN_TRANSIT": {
          data.carrierName = input.carrierName?.trim() || undefined;
          data.trackingNumber = input.trackingNumber?.trim() || undefined;
          data.trackingUrl = input.trackingUrl?.trim() || null;
          break;
        }
        case "RECORD_DELIVERY": {
          data.deliveredAt = now;
          data.deliveryEvidenceNote = input.deliveryEvidenceNote!.trim();
          break;
        }
        case "REPORT_FAILURE": {
          data.failureReason = input.reason!.trim();
          break;
        }
        case "CANCEL":
        case "RETRY": {
          data.statusReason = input.reason!.trim();
          data.failureReason = null;
          break;
        }
      }

      const claimed = await tx.supplierFulfilment.updateMany({
        where: { id: fulfilment.id, status: fulfilment.status },
        data,
      });
      if (claimed.count !== 1) {
        throw new SupplierFulfilmentError("The task changed concurrently. Reload and try again.", "concurrent_update", 409);
      }

      if (input.action === "CONFIRM_AVAILABILITY") {
        await ensurePurchaseRow(tx, { ...fulfilment, unitCostMinor: input.finalUnitCostMinor! });
      }
      if (input.action === "REPORT_FAILURE" || input.action === "CANCEL") {
        await tx.supplierPurchase.updateMany({
          where: { fulfilmentId: fulfilment.id, status: { in: ["PENDING_CONFIRMATION", "CONFIRMED"] } },
          data: {
            status: input.action === "CANCEL" ? "CANCELLED" : "FAILED",
            failureReason: input.reason!.trim(),
            cancelledAt: input.action === "CANCEL" ? now : null,
          },
        });
      }
      if (input.action === "RETRY") {
        await tx.supplierPurchase.updateMany({
          where: { fulfilmentId: fulfilment.id, status: { in: ["FAILED", "CANCELLED"] } },
          data: { status: "PENDING_CONFIRMATION", failureReason: null, cancelledAt: null },
        });
      }
      if (input.action === "RECORD_DISPATCH" || input.action === "RECORD_IN_TRANSIT" || input.action === "RECORD_DELIVERY") {
        const shipment = await tx.orderShipment.findUnique({
          where: { orderId: fulfilment.orderId },
          select: { id: true },
        });
        if (shipment) {
          await tx.orderShipment.update({
            where: { orderId: fulfilment.orderId },
            data: {
              status: input.action === "RECORD_DELIVERY" ? "DELIVERED" : "IN_TRANSIT",
              carrierName: input.carrierName?.trim() || undefined,
              trackingNumber: input.trackingNumber?.trim() || undefined,
              trackingUrl: input.trackingUrl?.trim() || null,
              dispatchedAt: input.action === "RECORD_DISPATCH" ? now : undefined,
              deliveredAt: input.action === "RECORD_DELIVERY" ? now : undefined,
              lastEventAt: now,
              deliveryNotes: input.action === "RECORD_DELIVERY" ? input.deliveryEvidenceNote!.trim() : undefined,
            },
          });
        } else if (input.carrierName?.trim() && input.trackingNumber?.trim()) {
          await tx.orderShipment.create({
            data: {
              orderId: fulfilment.orderId,
              carrierName: input.carrierName.trim(),
              trackingNumber: input.trackingNumber.trim(),
              trackingUrl: input.trackingUrl?.trim() || null,
              status: input.action === "RECORD_DELIVERY" ? "DELIVERED" : "IN_TRANSIT",
              dispatchedAt: input.action === "RECORD_DISPATCH" ? now : null,
              deliveredAt: input.action === "RECORD_DELIVERY" ? now : null,
              lastEventAt: now,
              deliveryNotes: input.action === "RECORD_DELIVERY" ? input.deliveryEvidenceNote!.trim() : null,
            },
          });
        }
        if (input.action === "RECORD_DELIVERY") {
          // Admin-reviewed delivery evidence only. We do NOT set
          // payoutEligibleAt or an inspection deadline automatically.
          await tx.order.update({
            where: { id: fulfilment.orderId },
            data: { deliveredAt: now },
          });
        }
      }

      await tx.supplierFulfilmentEvent.create({
        data: {
          fulfilmentId: fulfilment.id,
          fromStatus: fulfilment.status,
          toStatus: to,
          action: input.action,
          actorUserId: input.actor.id,
          actorRole: input.actor.role,
          idempotencyKey: eventKey,
          metadata: { orderNumber: fulfilment.orderNumber },
        },
      });

      return { id: fulfilment.id, reference: fulfilment.reference, from: fulfilment.status, to, idempotent: false };
    });
  } catch (error) {
    if (error instanceof SupplierFulfilmentError) throw error;
    if (isPrismaErrorCode(error, "P2002")) {
      return {
        id: input.fulfilmentId,
        reference: "",
        from: to,
        to,
        idempotent: true,
      };
    }
    logSafeError("Supplier fulfilment transition failed", error);
    throw new SupplierFulfilmentError("Unable to update fulfilment task.", "unexpected", 500);
  }
}

/** Post-commit audit + notifications. Never changes the authoritative state. */
export async function afterSupplierFulfilmentTransition(
  db: SupplierFulfilmentStore,
  result: { id: string; reference: string; from: SupplierFulfilmentStatus; to: SupplierFulfilmentStatus; idempotent: boolean },
  actor: { id: string; email?: string | null; role: "SELLER" | "ADMIN" | "SYSTEM" },
): Promise<void> {
  if (result.idempotent) return;
  const fulfilment = await db.supplierFulfilment.findUnique({
    where: { id: result.id },
    select: {
      buyerId: true, orderId: true, reference: true,
      seller: { select: { userId: true } },
    },
  });
  await logAuditEvent({
    action: "supplier_fulfilment.status_changed",
    actorId: actor.id,
    actorEmail: actor.email ?? null,
    targetType: "supplier_fulfilment",
    targetId: result.id,
    metadata: { from: result.from, to: result.to, actorRole: actor.role },
  }).catch(() => undefined);

  if (!fulfilment) return;
  await Promise.all([
    safeNotifyUser({
      userId: fulfilment.buyerId,
      type: "ORDER_UPDATE",
      title: `Order fulfilment update`,
      body: BUYER_FULFILMENT_MESSAGE[result.to],
      linkUrl: `/buyer/orders/${fulfilment.orderId}`,
    }),
    safeNotifyUser({
      userId: fulfilment.seller.userId,
      type: "ORDER_UPDATE",
      title: `Supplier task ${fulfilment.reference}: ${SUPPLIER_FULFILMENT_LABEL[result.to]}`,
      body: `The task moved from ${result.from} to ${result.to}.`,
      linkUrl: `/seller/orders/${fulfilment.orderId}`,
      sendEmailToo: false,
    }),
    result.to === "FAILED" || result.to === "CANCELLED"
      ? notifyAdministrators(db, {
          title: `Supplier fulfilment ${result.to.toLowerCase()}`,
          body: `Task ${fulfilment.reference} requires review. Buyer and seller were notified.`,
          linkUrl: `/admin/dropshipping/exceptions`,
        })
      : Promise.resolve(),
  ]);
}
