/**
 * Returns, cancellations and disputes for supplier-fulfilled lines.
 *
 * These rules extend — never replace — `BuyerProtectionCase`, `Refund`,
 * `Settlement` and `Payout`. A return request is a workflow record; it does
 * not issue a refund, release a payout or promise a replacement.
 */

import type {
  ProtectionCaseStatus,
  ProtectionReason,
  RefundStatus,
  SupplierReturnReason,
  SupplierReturnStatus,
} from "@prisma/client";

export const SUPPLIER_RETURN_TRANSITIONS: Readonly<
  Record<SupplierReturnStatus, readonly SupplierReturnStatus[]>
> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ITEM_RETURNED", "REJECTED", "CANCELLED"],
  ITEM_RETURNED: ["REFUND_PENDING", "RESOLVED", "CANCELLED"],
  REFUND_PENDING: ["RESOLVED", "CANCELLED"],
  REJECTED: [],
  RESOLVED: [],
  CANCELLED: [],
};

export const SUPPLIER_RETURN_LABEL: Record<SupplierReturnStatus, string> = {
  REQUESTED: "Return requested",
  APPROVED: "Return approved",
  REJECTED: "Return rejected",
  ITEM_RETURNED: "Item returned",
  REFUND_PENDING: "Refund pending",
  RESOLVED: "Resolved",
  CANCELLED: "Request cancelled",
};

/** Honest buyer-facing copy: no promise of an automatic refund or payout. */
export const BUYER_RETURN_MESSAGE: Record<SupplierReturnStatus, string> = {
  REQUESTED: "We received your request. Our team will review it before any refund or return is approved.",
  APPROVED: "Your return was approved. Follow the return instructions from support.",
  REJECTED: "Your return request was not approved. Contact support if you need more information.",
  ITEM_RETURNED: "The returned item was recorded. A refund decision is still required.",
  REFUND_PENDING: "A refund request is pending with the payment provider. It is not complete yet.",
  RESOLVED: "Your return or dispute has been resolved. See the resolution note for details.",
  CANCELLED: "This return request was cancelled.",
};

export function mapReturnReasonToProtectionReason(
  reason: SupplierReturnReason,
): ProtectionReason {
  switch (reason) {
    case "DAMAGED":
      return "DAMAGED_ITEM";
    case "INCORRECT":
      return "WRONG_ITEM";
    case "COUNTERFEIT":
      return "ITEM_NOT_AS_DESCRIBED";
    case "UNDELIVERED":
      return "ITEM_NOT_RECEIVED";
    default:
      return "OTHER";
  }
}

export type ReturnTransitionRequest = {
  from: SupplierReturnStatus;
  to: SupplierReturnStatus;
  actorRole: "BUYER" | "ADMIN";
  ownsRequest?: boolean;
  /** Provider-confirmed refund status. Required to resolve REFUND_PENDING. */
  refundStatus?: RefundStatus | null;
  resolutionNote?: string | null;
};

export type ReturnTransitionDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export function assertSupplierReturnTransition(
  request: ReturnTransitionRequest,
): ReturnTransitionDecision {
  const { from, to, actorRole } = request;
  if (from === to) {
    return { allowed: false, code: "unchanged", message: "The request is already in that state." };
  }
  if (!SUPPLIER_RETURN_TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      code: "invalid_transition",
      message: `A return request cannot move from ${from} to ${to}.`,
    };
  }
  if (actorRole === "BUYER") {
    if (to !== "CANCELLED" || from !== "REQUESTED" || !request.ownsRequest) {
      return { allowed: false, code: "admin_only", message: "Only an administrator can change this status." };
    }
    return { allowed: true };
  }
  if (to === "RESOLVED" && !request.resolutionNote?.trim()) {
    return { allowed: false, code: "resolution_note_required", message: "A resolution note is required." };
  }
  if (from === "REFUND_PENDING" && to === "RESOLVED" && request.refundStatus !== "COMPLETED") {
    return {
      allowed: false,
      code: "refund_not_confirmed",
      message: "A provider-confirmed refund is required before resolving a refund-pending return.",
    };
  }
  return { allowed: true };
}

/**
 * Payout-hold rule for the existing settlement/payout workflow.
 *
 * An OPEN/UNDER_REVIEW protection case, an unresolved return, or a pending
 * refund blocks payout eligibility. This is a GUARD, not a payout service:
 * no automatic release exists in this repository, and no escrow is implied.
 */
export function isSupplierPayoutHoldActive(params: {
  protectionCaseStatus?: ProtectionCaseStatus | null;
  returnStatus?: SupplierReturnStatus | null;
  refundStatus?: RefundStatus | null;
}): boolean {
  if (
    params.protectionCaseStatus === "OPEN" ||
    params.protectionCaseStatus === "UNDER_REVIEW"
  ) {
    return true;
  }
  if (
    params.returnStatus === "REQUESTED" ||
    params.returnStatus === "APPROVED" ||
    params.returnStatus === "ITEM_RETURNED" ||
    params.returnStatus === "REFUND_PENDING"
  ) {
    return true;
  }
  if (params.refundStatus === "PENDING" || params.refundStatus === "PROCESSING") {
    return true;
  }
  return false;
}
