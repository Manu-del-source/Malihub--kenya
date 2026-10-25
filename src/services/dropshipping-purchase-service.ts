import "server-only";

import type { Prisma, PrismaClient, SupplierPurchaseStatus } from "@prisma/client";
import { logAuditEvent } from "@/services/audit-service";
import { isPrismaErrorCode, logSafeError } from "@/lib/dropshipping/http";
import { uuidSchema } from "@/lib/validations/dropshipping";
import { safeNotifyUser } from "@/services/dropshipping-notifications";

export type SupplierPurchaseStore = Pick<
  PrismaClient,
  "supplierPurchase" | "supplierFulfilment" | "order" | "seller" | "$transaction"
>;

export class SupplierPurchaseError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "SupplierPurchaseError";
    this.code = code;
    this.status = status;
  }
}

export type PurchaseActionInput = {
  fulfilmentId: string;
  action: "CONFIRM" | "FAIL" | "RECONCILE";
  actor: { id: string; email?: string | null; role: "SELLER" | "ADMIN" };
  paymentReference?: string | null;
  purchaseReference?: string | null;
  reason?: string | null;
  refundAmountMinor?: number;
  reconciliationNote?: string | null;
};

/**
 * Manual supplier purchase controls. Nothing here calls a payment provider,
 * moves money, or claims escrow. CONFIRM records an authorized purchase order;
 * RECONCILE records manual payment/refund evidence and an audited comparison
 * against the customer order. The row is unique per fulfilment and has a
 * deterministic idempotency key, so retries cannot duplicate a financial
 * action.
 */
export async function handleSupplierPurchaseAction(
  db: SupplierPurchaseStore,
  input: PurchaseActionInput,
): Promise<SupplierPurchaseActionResult> {
  if (!uuidSchema.safeParse(input.fulfilmentId).success) {
    throw new SupplierPurchaseError("Invalid fulfilment id.", "invalid_id", 400);
  }
  if (input.action === "FAIL" && !input.reason?.trim()) {
    throw new SupplierPurchaseError("A failure reason is required.", "reason_required", 400);
  }
  if (input.action === "RECONCILE" && !input.reconciliationNote?.trim()) {
    throw new SupplierPurchaseError("A reconciliation note is required.", "note_required", 400);
  }
  if (input.refundAmountMinor !== undefined && (!Number.isSafeInteger(input.refundAmountMinor) || input.refundAmountMinor < 0)) {
    throw new SupplierPurchaseError("Refund amount must be a non-negative integer.", "invalid_amount", 400);
  }

  try {
    return await db.$transaction(async (tx) => {
      const purchase = await tx.supplierPurchase.findUnique({
        where: { fulfilmentId: input.fulfilmentId },
        select: {
          id: true, status: true, amountMinor: true, currency: true,
          costStatus: true, paymentResponsibility: true, paymentTerms: true,
          purchaseReference: true, refundAmountMinor: true,
          fulfilment: {
            select: {
              id: true, reference: true, orderId: true, status: true,
              seller: { select: { userId: true } },
            },
          },
        },
      });
      const fulfilment = await tx.supplierFulfilment.findUnique({
        where: { id: input.fulfilmentId },
        select: {
          id: true, orderId: true, reference: true,
          order: { select: { totalCents: true, orderNumber: true } },
        },
      });
      if (!purchase || !fulfilment) {
        throw new SupplierPurchaseError("Supplier purchase record not found.", "not_found", 404);
      }
      if (input.actor.role === "SELLER" && purchase.fulfilment.seller.userId !== input.actor.id) {
        throw new SupplierPurchaseError("This purchase belongs to another seller.", "forbidden", 403);
      }

      const from = purchase.status as string;
      const now = new Date();
      const data: Prisma.SupplierPurchaseUncheckedUpdateInput = {};
      let target = from;
      let idempotent = false;

      switch (input.action) {
        case "CONFIRM": {
          if (from === "CONFIRMED") {
            idempotent = true;
            break;
          }
          if (from !== "PENDING_CONFIRMATION") {
            throw new SupplierPurchaseError(`A ${from.toLowerCase()} purchase cannot be confirmed.`, "invalid_transition", 409);
          }
          if (purchase.costStatus !== "CONFIRMED") {
            throw new SupplierPurchaseError("Confirm the final supplier cost before the purchase.", "cost_unconfirmed", 409);
          }
          if (purchase.paymentResponsibility === "UNDEFINED" || !purchase.paymentTerms) {
            throw new SupplierPurchaseError(
              "Supplier payment responsibility and payment terms must be verified before purchase confirmation.",
              "commercial_terms_missing",
              422,
            );
          }
          target = "CONFIRMED";
          data.status = "CONFIRMED";
          data.confirmedAt = now;
          data.confirmedById = input.actor.id;
          data.purchaseReference = input.purchaseReference?.trim() || purchase.purchaseReference;
          break;
        }
        case "FAIL": {
          if (from === "FAILED") {
            idempotent = true;
            break;
          }
          if (from === "REFUNDED" || from === "CANCELLED") {
            throw new SupplierPurchaseError(`A ${from.toLowerCase()} purchase cannot be failed.`, "invalid_transition", 409);
          }
          target = "FAILED";
          data.status = "FAILED";
          data.failureReason = input.reason!.trim();
          data.refundAmountMinor = input.refundAmountMinor ?? purchase.refundAmountMinor;
          break;
        }
        case "RECONCILE": {
          if (!["CONFIRMED", "FAILED", "REFUNDED"].includes(from)) {
            throw new SupplierPurchaseError(`A ${from.toLowerCase()} purchase cannot be reconciled.`, "invalid_transition", 409);
          }
          const refundAmount = input.refundAmountMinor ?? purchase.refundAmountMinor;
          if (refundAmount > purchase.amountMinor) {
            throw new SupplierPurchaseError("Refund amount cannot exceed the supplier purchase amount.", "invalid_amount", 400);
          }
          target = refundAmount >= purchase.amountMinor && refundAmount > 0 ? "REFUNDED" : from;
          data.refundAmountMinor = refundAmount;
          data.reconciledAt = now;
          data.reconciledById = input.actor.id;
          data.reconciliationNote = input.reconciliationNote!.trim();
          data.status = target as SupplierPurchaseStatus;
          if (input.paymentReference?.trim()) {
            // A manual, non-secret receipt/statement reference. It is evidence
            // of a human payment, not a provider callback or proof of transfer.
            data.paymentReference = input.paymentReference.trim();
            data.paidAt = now;
            data.paidById = input.actor.id;
          }
          break;
        }
      }

      if (!idempotent) {
        const claimed = await tx.supplierPurchase.updateMany({
          where: { id: purchase.id, status: from as SupplierPurchaseStatus },
          data,
        });
        if (claimed.count !== 1) {
          throw new SupplierPurchaseError("The purchase changed concurrently. Reload and try again.", "concurrent_update", 409);
        }
      }

      return {
        id: purchase.id,
        status: target,
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        customerOrderTotalCents: fulfilment.order.totalCents,
        reconciliationNote: input.action === "RECONCILE" ? input.reconciliationNote!.trim() : null,
        idempotent,
        // Internal fields used only for the post-commit fan-out.
        _auditAction:
          input.action === "CONFIRM"
            ? "supplier_purchase.confirmed"
            : input.action === "FAIL"
              ? "supplier_purchase.failed"
              : "supplier_purchase.reconciled",
        _orderNumber: fulfilment.order.orderNumber,
        _sellerUserId: purchase.fulfilment.seller.userId,
      };
    });
  } catch (error) {
    if (error instanceof SupplierPurchaseError) throw error;
    if (isPrismaErrorCode(error, "P2002")) {
      throw new SupplierPurchaseError("A duplicate purchase record was prevented.", "duplicate", 409);
    }
    logSafeError("Supplier purchase action failed", error);
    throw new SupplierPurchaseError("Unable to update supplier purchase.", "unexpected", 500);
  }
}

export type SupplierPurchaseActionResult = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  customerOrderTotalCents: number;
  reconciliationNote: string | null;
  idempotent: boolean;
  /** Internal post-commit fan-out fields; not part of the API response. */
  _auditAction: string;
  _orderNumber: string;
  _sellerUserId: string;
};

/** Post-commit audit and seller notification, safe to fail independently. */
export async function afterSupplierPurchaseAction(
  result: SupplierPurchaseActionResult,
  actor: { id: string; email?: string | null },
): Promise<void> {
  if (result.idempotent) return;
  await logAuditEvent({
    action: result._auditAction as never,
    actorId: actor.id,
    actorEmail: actor.email ?? null,
    targetType: "supplier_purchase",
    targetId: result.id,
    metadata: { status: result.status, customerOrderTotalCents: result.customerOrderTotalCents },
  }).catch(() => undefined);
  await safeNotifyUser({
    userId: result._sellerUserId,
    type: "ORDER_UPDATE",
    title: `Supplier purchase ${result.status.toLowerCase()}`,
    body: `Order ${result._orderNumber}: supplier purchase status is ${result.status}. No payment was sent automatically.`,
    linkUrl: `/seller/orders`,
    sendEmailToo: false,
  });
}
