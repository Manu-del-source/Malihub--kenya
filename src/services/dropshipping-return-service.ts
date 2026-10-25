import "server-only";

import type {
  Prisma,
  PrismaClient,
  SupplierReturnReason,
  SupplierReturnStatus,
  ReturnResponsibility,
  ProtectionCaseStatus,
  RefundStatus,
} from "@prisma/client";
import { logAuditEvent } from "@/services/audit-service";
import {
  assertSupplierReturnTransition,
  BUYER_RETURN_MESSAGE,
  isSupplierPayoutHoldActive,
  mapReturnReasonToProtectionReason,
} from "@/lib/dropshipping/return-state-machine";
import {
  supplierReturnIdempotencyKey,
  supplierReturnRefundIdempotencyKey,
} from "@/lib/dropshipping/ids";
import { isPrismaErrorCode, logSafeError } from "@/lib/dropshipping/http";
import { uuidSchema } from "@/lib/validations/dropshipping";
import { safeNotifyUser, notifyAdministrators } from "@/services/dropshipping-notifications";

export type SupplierReturnStore = Pick<
  PrismaClient,
  | "supplierReturnRequest"
  | "supplierFulfilment"
  | "buyerProtectionCase"
  | "refund"
  | "payment"
  | "orderItem"
  | "seller"
  | "user"
  | "$transaction"
>;

export class SupplierReturnError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "SupplierReturnError";
    this.code = code;
    this.status = status;
  }
}

export type ReturnRequestInput = {
  fulfilmentId: string;
  buyerId: string;
  reason: SupplierReturnReason;
  reasonNote: string;
  evidenceNote?: string | null;
  idempotencyKey?: string;
};

/**
 * Records a buyer cancel/return/dispute request for one supplier-fulfilled
 * line. Opens or reopens the EXISTING BuyerProtectionCase (one per order) and
 * holds payout eligibility through `isSupplierPayoutHoldActive`. It never
 * issues a refund, releases a payout or promises a replacement.
 */
export async function createSupplierReturnRequest(
  db: SupplierReturnStore,
  input: ReturnRequestInput,
): Promise<SupplierReturnRequestResult> {
  if (!uuidSchema.safeParse(input.fulfilmentId).success) {
    throw new SupplierReturnError("Invalid fulfilment id.", "invalid_id", 400);
  }
  const key = input.idempotencyKey ?? supplierReturnIdempotencyKey(input.fulfilmentId);

  try {
    return await db.$transaction(async (tx) => {
      const existingByKey = await tx.supplierReturnRequest.findUnique({
        where: { idempotencyKey: key },
        select: { id: true, status: true, protectionCaseId: true },
      });
      if (existingByKey) {
        return { ...existingByKey, protectionCaseId: existingByKey.protectionCaseId ?? "", idempotent: true };
      }
      const existingByFulfilment = await tx.supplierReturnRequest.findUnique({
        where: { fulfilmentId: input.fulfilmentId },
        select: { id: true },
      });
      if (existingByFulfilment) {
        throw new SupplierReturnError("A return request already exists for this item.", "already_exists", 409);
      }

      const fulfilment = await tx.supplierFulfilment.findUnique({
        where: { id: input.fulfilmentId },
        select: {
          id: true, orderId: true, buyerId: true, status: true, reference: true,
          orderItemId: true, seller: { select: { userId: true } },
        },
      });
      if (!fulfilment) throw new SupplierReturnError("Fulfilment task not found.", "not_found", 404);
      if (fulfilment.buyerId !== input.buyerId) {
        throw new SupplierReturnError("This order belongs to another buyer.", "forbidden", 403);
      }
      if (fulfilment.status === "AWAITING_PAYMENT" || fulfilment.status === "CANCELLED") {
        throw new SupplierReturnError("A return cannot be requested for this fulfilment state.", "invalid_state", 409);
      }

      const request = await tx.supplierReturnRequest.create({
        data: {
          fulfilmentId: input.fulfilmentId,
          orderId: fulfilment.orderId,
          buyerId: input.buyerId,
          status: "REQUESTED",
          reason: input.reason,
          reasonNote: input.reasonNote,
          evidenceNote: input.evidenceNote ?? null,
          responsibility: "UNDETERMINED",
          idempotencyKey: key,
        },
        select: { id: true, status: true },
      });

      // Reuse the single existing protection case for the order. Reopening a
      // resolved case appends the new reason to the description and is audited.
      const protectionReason = mapReturnReasonToProtectionReason(input.reason);
      const existingCase = await tx.buyerProtectionCase.findUnique({
        where: { orderId: fulfilment.orderId },
        select: { id: true, status: true, description: true },
      });
      let protectionCaseId: string;
      if (!existingCase) {
        const opened = await tx.buyerProtectionCase.create({
          data: {
            orderId: fulfilment.orderId,
            buyerId: input.buyerId,
            reason: protectionReason,
            status: "OPEN",
            description: input.reasonNote,
          },
          select: { id: true },
        });
        protectionCaseId = opened.id;
      } else {
        protectionCaseId = existingCase.id;
        const shouldReopen = !["OPEN", "UNDER_REVIEW"].includes(existingCase.status);
        if (shouldReopen) {
          await tx.buyerProtectionCase.update({
            where: { id: existingCase.id },
            data: {
              status: "OPEN",
              resolvedAt: null,
              description: `${existingCase.description}\n\nReopened: ${input.reasonNote}`,
            },
          });
        }
      }
      await tx.supplierReturnRequest.update({
        where: { id: request.id },
        data: { protectionCaseId },
      });

      return {
        id: request.id,
        status: request.status as SupplierReturnStatus,
        protectionCaseId,
        idempotent: false,
        // Internal fields for post-commit fan-out only.
        _buyerId: input.buyerId,
        _sellerUserId: fulfilment.seller.userId,
        _orderId: fulfilment.orderId,
        _reference: fulfilment.reference,
      } as SupplierReturnRequestResult;
    });
  } catch (error) {
    if (error instanceof SupplierReturnError) throw error;
    if (isPrismaErrorCode(error, "P2002")) {
      throw new SupplierReturnError("A duplicate return request was prevented.", "duplicate", 409);
    }
    logSafeError("Supplier return request failed", error);
    throw new SupplierReturnError("Unable to record return request.", "unexpected", 500);
  }
}

export type SupplierReturnRequestResult = {
  id: string;
  status: SupplierReturnStatus;
  protectionCaseId: string;
  idempotent: boolean;
  _buyerId?: string;
  _sellerUserId?: string;
  _orderId?: string;
  _reference?: string;
};

export async function afterReturnRequestCreated(
  db: SupplierReturnStore,
  result: SupplierReturnRequestResult,
): Promise<void> {
  if (result.idempotent || !result._buyerId) return;
  await Promise.all([
    logAuditEvent({
      action: "supplier_return.requested",
      actorId: result._buyerId,
      targetType: "supplier_return_request",
      targetId: result.id,
      metadata: { status: "REQUESTED", protectionCaseId: result.protectionCaseId },
    }).catch(() => undefined),
    logAuditEvent({
      action: "supplier_return.payout_hold",
      actorId: result._buyerId,
      targetType: "supplier_return_request",
      targetId: result.id,
      metadata: { active: true, reason: "return_requested" },
    }).catch(() => undefined),
    safeNotifyUser({
      userId: result._buyerId,
      type: "ORDER_UPDATE",
      title: "Return or dispute request received",
      body: BUYER_RETURN_MESSAGE.REQUESTED,
      linkUrl: `/buyer/orders/${result._orderId}`,
    }),
    safeNotifyUser({
      userId: result._sellerUserId!,
      type: "ORDER_UPDATE",
      title: `Return request for ${result._reference}`,
      body: "A buyer requested a return or dispute. Payout eligibility is held while an administrator reviews it.",
      linkUrl: `/seller/orders/${result._orderId}`,
      sendEmailToo: false,
    }),
    notifyAdministrators(db, {
      title: "Return/dispute needs review",
      body: `Supplier fulfilment ${result._reference} has a new return request.`,
      linkUrl: `/admin/dropshipping/returns`,
    }),
  ]);
}

export type ReturnDecisionInput = {
  returnRequestId: string;
  status: SupplierReturnStatus;
  actor: { id: string; email?: string | null; role: "ADMIN" };
  responsibility?: ReturnResponsibility;
  returnShippingParty?: string | null;
  resolutionNote?: string | null;
};

/**
 * Authorized admin return transitions. `REFUND_PENDING → RESOLVED` requires a
 * provider-confirmed COMPLETED Refund row, never a client claim. Moving to
 * REFUND_PENDING creates at most one PENDING Refund request with a
 * deterministic idempotency key; no provider call is made.
 */
export async function updateSupplierReturnStatus(
  db: SupplierReturnStore,
  input: ReturnDecisionInput,
): Promise<ReturnDecisionResult> {
  if (!uuidSchema.safeParse(input.returnRequestId).success) {
    throw new SupplierReturnError("Invalid return request id.", "invalid_id", 400);
  }

  try {
    return await db.$transaction(async (tx) => {
      const request = await tx.supplierReturnRequest.findUnique({
        where: { id: input.returnRequestId },
        select: {
          id: true, status: true, fulfilmentId: true, orderId: true,
          buyerId: true, reason: true, refundId: true,
          protectionCaseId: true, responsibility: true,
          refund: { select: { status: true } },
          fulfilment: {
            select: {
              reference: true, orderItemId: true,
              seller: { select: { userId: true } },
            },
          },
        },
      });
      if (!request) throw new SupplierReturnError("Return request not found.", "not_found", 404);

      let refundId = request.refundId;
      let refundStatus: string | null = request.refund?.status ?? null;
      if (input.status === "REFUND_PENDING" && request.status !== "REFUND_PENDING") {
        // Create a PENDING refund REQUEST, never a confirmed refund. Unique
        // idempotency key prevents duplicate refund instructions on retry.
        const payment = await tx.payment.findFirst({
          where: { orderId: request.orderId, status: "SUCCESS" },
          select: { id: true, provider: true },
          orderBy: { createdAt: "desc" },
        });
        const orderItem = await tx.orderItem.findUnique({
          where: { id: request.fulfilment.orderItemId },
          select: { totalCents: true },
        });
        if (!payment || !orderItem) {
          throw new SupplierReturnError(
            "A successful customer payment and order item are required before a refund request.",
            "refund_source_missing",
            409,
          );
        }
        const existingRefund = await tx.refund.findUnique({
          where: { idempotencyKey: supplierReturnRefundIdempotencyKey(request.id) },
          select: { id: true, status: true },
        });
        if (existingRefund) {
          refundId = existingRefund.id;
          refundStatus = existingRefund.status;
        } else {
          const created = await tx.refund.create({
            data: {
              paymentId: payment.id,
              orderId: request.orderId,
              amountCents: orderItem.totalCents,
              reason: `Supplier return ${request.reason} — admin-approved refund request`,
              initiatedByUserId: input.actor.id,
              provider: payment.provider,
              idempotencyKey: supplierReturnRefundIdempotencyKey(request.id),
              status: "PENDING",
            },
            select: { id: true, status: true },
          });
          refundId = created.id;
          refundStatus = created.status;
        }
      }

      const decision = assertSupplierReturnTransition({
        from: request.status as SupplierReturnStatus,
        to: input.status,
        actorRole: input.actor.role,
        refundStatus: refundStatus as RefundStatus | null,
        resolutionNote: input.resolutionNote,
      });
      if (!decision.allowed) {
        throw new SupplierReturnError(decision.message, decision.code, 409);
      }

      const now = new Date();
      const data: Prisma.SupplierReturnRequestUncheckedUpdateInput = {
        status: input.status,
        ...(input.responsibility ? { responsibility: input.responsibility } : {}),
        ...(input.returnShippingParty ? { returnShippingParty: input.returnShippingParty } : {}),
        ...(refundId ? { refundId } : {}),
      };
      switch (input.status) {
        case "APPROVED":
          data.approvedAt = now;
          data.approvedById = input.actor.id;
          break;
        case "REJECTED":
          data.rejectedAt = now;
          data.resolutionNote = input.resolutionNote ?? null;
          break;
        case "ITEM_RETURNED":
          data.returnedAt = now;
          break;
        case "REFUND_PENDING":
          data.refundPendingAt = now;
          break;
        case "RESOLVED":
          data.resolvedAt = now;
          data.resolvedById = input.actor.id;
          data.resolutionNote = input.resolutionNote!;
          break;
        case "CANCELLED":
          data.resolutionNote = input.resolutionNote ?? null;
          break;
      }

      const claimed = await tx.supplierReturnRequest.updateMany({
        where: { id: request.id, status: request.status as SupplierReturnStatus },
        data,
      });
      if (claimed.count !== 1) {
        throw new SupplierReturnError("The return request changed concurrently. Reload and try again.", "concurrent_update", 409);
      }

      // Resolve or close the linked buyer-protection case when the request
      // leaves a payout-holding state. No payout is released automatically.
      if (request.protectionCaseId && ["RESOLVED", "REJECTED", "CANCELLED"].includes(input.status)) {
        const responsibility = input.responsibility ?? request.responsibility;
        let caseStatus: ProtectionCaseStatus = "CLOSED";
        if (responsibility === "BUYER") caseStatus = "RESOLVED_SELLER";
        else if (["SUPPLIER", "SELLER", "COURIER", "PLATFORM"].includes(String(responsibility))) {
          caseStatus = "RESOLVED_BUYER";
        }
        await tx.buyerProtectionCase.update({
          where: { id: request.protectionCaseId },
          data: {
            status: caseStatus,
            resolvedAt: now,
            resolutionNote: input.resolutionNote ?? null,
          },
        });
      }

      const payoutHoldActive = isSupplierPayoutHoldActive({
        returnStatus: input.status,
        refundStatus: refundStatus as RefundStatus | null,
        protectionCaseStatus: ["RESOLVED", "REJECTED", "CANCELLED"].includes(input.status)
          ? "CLOSED"
          : "OPEN",
      });

      return {
        id: request.id,
        from: request.status as SupplierReturnStatus,
        to: input.status,
        refundId,
        payoutHoldActive,
        // Internal fields for post-commit fan-out only.
        _buyerId: request.buyerId,
        _sellerUserId: request.fulfilment.seller.userId,
        _orderId: request.orderId,
        _reference: request.fulfilment.reference,
      } as ReturnDecisionResult;
    });
  } catch (error) {
    if (error instanceof SupplierReturnError) throw error;
    if (isPrismaErrorCode(error, "P2002")) {
      throw new SupplierReturnError("A duplicate refund request was prevented.", "duplicate_refund", 409);
    }
    logSafeError("Supplier return decision failed", error);
    throw new SupplierReturnError("Unable to update return request.", "unexpected", 500);
  }
}

export type ReturnDecisionResult = {
  id: string;
  from: SupplierReturnStatus;
  to: SupplierReturnStatus;
  refundId: string | null;
  payoutHoldActive: boolean;
  _buyerId?: string;
  _sellerUserId?: string;
  _orderId?: string;
  _reference?: string;
};

export async function afterReturnDecision(
  db: SupplierReturnStore,
  result: ReturnDecisionResult,
  actor: { id: string; email?: string | null },
): Promise<void> {
  if (!result._buyerId) return;
  await logAuditEvent({
    action: "supplier_return.status_changed",
    actorId: actor.id,
    actorEmail: actor.email ?? null,
    targetType: "supplier_return_request",
    targetId: result.id,
    metadata: { from: result.from, to: result.to, payoutHoldActive: result.payoutHoldActive },
  }).catch(() => undefined);
  if (result.payoutHoldActive) {
    await logAuditEvent({
      action: "supplier_return.payout_hold",
      actorId: actor.id,
      targetType: "supplier_return_request",
      targetId: result.id,
      metadata: { active: true, status: result.to },
    }).catch(() => undefined);
  }
  await Promise.all([
    safeNotifyUser({
      userId: result._buyerId,
      type: "ORDER_UPDATE",
      title: "Return or dispute update",
      body: BUYER_RETURN_MESSAGE[result.to],
      linkUrl: `/buyer/orders/${result._orderId}`,
    }),
    safeNotifyUser({
      userId: result._sellerUserId!,
      type: "ORDER_UPDATE",
      title: `Return request ${result.to.toLowerCase()}`,
      body: `Supplier fulfilment ${result._reference}: ${result.to}.`,
      linkUrl: `/seller/orders/${result._orderId}`,
      sendEmailToo: false,
    }),
    result.to === "REQUESTED" || result.to === "REFUND_PENDING"
      ? notifyAdministrators(db, {
          title: "Return/dispute needs attention",
          body: `Supplier fulfilment ${result._reference} is ${result.to}.`,
          linkUrl: `/admin/dropshipping/returns`,
        })
      : Promise.resolve(),
  ]);
}
