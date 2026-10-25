/**
 * The supplier-fulfilment lifecycle — pure rules, no database access.
 *
 * This is deliberately SEPARATE from `Order.status`. A supplier can dispatch a
 * parcel while the MaliHub order is still awaiting an independently reviewed
 * delivery confirmation; the two state machines must never be collapsed.
 *
 * Authority matters as much as reachability. In particular:
 *  - only a verified payment hook can move AWAITING_PAYMENT forward;
 *  - only the seller who owns the order can confirm cost/purchase/dispatch;
 *  - only an administrator can record DELIVERED (with evidence), because a
 *    supplier's "dispatched" claim is not proof of delivery;
 *  - a FAILED task can be reopened only by an administrator with a reason.
 */

import type { SupplierFulfilmentStatus } from "@prisma/client";

export type SupplierActorRole = "SELLER" | "ADMIN" | "SYSTEM";

export const SUPPLIER_FULFILMENT_TRANSITIONS: Readonly<
  Record<SupplierFulfilmentStatus, readonly SupplierFulfilmentStatus[]>
> = {
  AWAITING_PAYMENT: ["AWAITING_SUPPLIER_CONFIRMATION", "CANCELLED", "FAILED"],
  AWAITING_SUPPLIER_CONFIRMATION: ["CONFIRMED", "FAILED", "CANCELLED"],
  CONFIRMED: ["ORDERED", "FAILED", "CANCELLED"],
  ORDERED: ["DISPATCHED", "IN_TRANSIT", "FAILED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT", "FAILED", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "FAILED", "CANCELLED"],
  DELIVERED: [],
  FAILED: ["AWAITING_SUPPLIER_CONFIRMATION", "CANCELLED"],
  CANCELLED: [],
};

export const SUPPLIER_FULFILMENT_TERMINAL: readonly SupplierFulfilmentStatus[] = [
  "DELIVERED",
  "CANCELLED",
];

export const SUPPLIER_FULFILMENT_LABEL: Record<SupplierFulfilmentStatus, string> = {
  AWAITING_PAYMENT: "Awaiting verified payment",
  AWAITING_SUPPLIER_CONFIRMATION: "Awaiting supplier confirmation",
  CONFIRMED: "Availability confirmed",
  ORDERED: "Supplier order recorded",
  DISPATCHED: "Dispatched by supplier",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered (evidence reviewed)",
  FAILED: "Fulfilment failed",
  CANCELLED: "Cancelled",
};

/** Buyer-safe copy. Never mentions supplier identity, cost or purchase status. */
export const BUYER_FULFILMENT_MESSAGE: Record<SupplierFulfilmentStatus, string> = {
  AWAITING_PAYMENT: "We are waiting for payment confirmation before processing your order.",
  AWAITING_SUPPLIER_CONFIRMATION: "Payment confirmed. We are confirming availability for your item.",
  CONFIRMED: "Availability confirmed. Your item is being prepared.",
  ORDERED: "Your item has been ordered for fulfilment.",
  DISPATCHED: "Your item has been dispatched. Tracking will appear here when available.",
  IN_TRANSIT: "Your item is in transit. Follow the tracking details on this order.",
  DELIVERED: "Delivery was recorded and reviewed. You can confirm receipt in your order.",
  FAILED: "We could not fulfil this item. Our team is reviewing the next step.",
  CANCELLED: "This item was cancelled. Contact support if you have questions.",
};

export type TransitionRequest = {
  from: SupplierFulfilmentStatus;
  to: SupplierFulfilmentStatus;
  actorRole: SupplierActorRole;
  /** Required for seller actions; ownership is re-checked against the DB row. */
  ownsOrder?: boolean;
  /** Admin-only evidence note for an independently reviewed delivery. */
  deliveryEvidenceNote?: string | null;
  /** Required for FAILED and CANCELLED. */
  reason?: string | null;
  /** Required for retrying a FAILED task. */
  retryApproved?: boolean;
};

export type TransitionDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export function allowedSupplierFulfilmentTransitions(
  from: SupplierFulfilmentStatus,
): readonly SupplierFulfilmentStatus[] {
  return SUPPLIER_FULFILMENT_TRANSITIONS[from] ?? [];
}

export function isTerminalSupplierFulfilmentStatus(
  status: SupplierFulfilmentStatus,
): boolean {
  return SUPPLIER_FULFILMENT_TERMINAL.includes(status);
}

export function assertSupplierFulfilmentTransition(
  request: TransitionRequest,
): TransitionDecision {
  const { from, to, actorRole } = request;
  if (from === to) {
    return { allowed: false, code: "unchanged", message: "The task is already in that state." };
  }
  if (!allowedSupplierFulfilmentTransitions(from).includes(to)) {
    return {
      allowed: false,
      code: "invalid_transition",
      message: `A supplier fulfilment task cannot move from ${from} to ${to}.`,
    };
  }

  if (to === "AWAITING_SUPPLIER_CONFIRMATION" && from === "AWAITING_PAYMENT" && actorRole !== "SYSTEM") {
    return { allowed: false, code: "system_only", message: "Only verified payment confirmation can start this task." };
  }
  if (from === "FAILED" && to === "AWAITING_SUPPLIER_CONFIRMATION") {
    if (actorRole !== "ADMIN" || !request.retryApproved) {
      return { allowed: false, code: "admin_retry_required", message: "An administrator must approve a retry." };
    }
  } else if (actorRole === "SELLER" && !request.ownsOrder) {
    return { allowed: false, code: "not_owner", message: "This task belongs to another seller." };
  }

  if (to === "DELIVERED") {
    if (actorRole !== "ADMIN") {
      return { allowed: false, code: "delivery_review_required", message: "An administrator must review delivery evidence." };
    }
    if (!request.deliveryEvidenceNote?.trim()) {
      return { allowed: false, code: "delivery_evidence_required", message: "Delivery evidence is required." };
    }
  }
  if ((to === "FAILED" || to === "CANCELLED") && !request.reason?.trim()) {
    return { allowed: false, code: "reason_required", message: "A reason is required for this outcome." };
  }
  if (to === "CANCELLED" && actorRole === "SELLER") {
    return { allowed: false, code: "admin_cancel_required", message: "An administrator must cancel a paid fulfilment task." };
  }
  return { allowed: true };
}
