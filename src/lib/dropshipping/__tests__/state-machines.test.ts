import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertSupplierFulfilmentTransition,
  allowedSupplierFulfilmentTransitions,
  isTerminalSupplierFulfilmentStatus,
  type TransitionDecision,
} from "../fulfilment-state-machine";
import {
  assertSupplierReturnTransition,
  isSupplierPayoutHoldActive,
  mapReturnReasonToProtectionReason,
  type ReturnTransitionDecision,
} from "../return-state-machine";

type Decision = TransitionDecision | ReturnTransitionDecision;
const codeOf = (decision: Decision): string | undefined =>
  "code" in decision ? decision.code : undefined;
const allowed = (decision: Decision): boolean => decision.allowed === true;

describe("supplier fulfilment state machine", () => {
  it("allows only the documented path from payment to delivery", () => {
    const path = [
      "AWAITING_PAYMENT",
      "AWAITING_SUPPLIER_CONFIRMATION",
      "CONFIRMED",
      "ORDERED",
      "DISPATCHED",
      "IN_TRANSIT",
      "DELIVERED",
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      assert.ok(allowedSupplierFulfilmentTransitions(path[i]!).includes(path[i + 1]!));
    }
    assert.equal(isTerminalSupplierFulfilmentStatus("DELIVERED"), true);
    assert.equal(isTerminalSupplierFulfilmentStatus("CANCELLED"), true);
    assert.deepEqual(allowedSupplierFulfilmentTransitions("DELIVERED"), []);
  });

  it("refuses shortcuts, unchanged states and resurrection of cancelled tasks", () => {
    const shortcut = assertSupplierFulfilmentTransition({
      from: "AWAITING_PAYMENT", to: "DELIVERED", actorRole: "ADMIN",
      deliveryEvidenceNote: "courier proof",
    });
    assert.equal(codeOf(shortcut), "invalid_transition");

    const unchanged = assertSupplierFulfilmentTransition({
      from: "CONFIRMED", to: "CONFIRMED", actorRole: "SELLER", ownsOrder: true,
    });
    assert.equal(codeOf(unchanged), "unchanged");

    const cancelled = assertSupplierFulfilmentTransition({ from: "CANCELLED", to: "ORDERED", actorRole: "ADMIN" });
    assert.equal(codeOf(cancelled), "invalid_transition");
  });

  it("only a verified-payment system hook can start a task", () => {
    const seller = assertSupplierFulfilmentTransition({
      from: "AWAITING_PAYMENT", to: "AWAITING_SUPPLIER_CONFIRMATION",
      actorRole: "SELLER", ownsOrder: true,
    });
    assert.equal(codeOf(seller), "system_only");
    const system = assertSupplierFulfilmentTransition({
      from: "AWAITING_PAYMENT", to: "AWAITING_SUPPLIER_CONFIRMATION", actorRole: "SYSTEM",
    });
    assert.equal(allowed(system), true);
  });

  it("requires seller ownership and an admin-reviewed delivery with evidence", () => {
    const notOwner = assertSupplierFulfilmentTransition({
      from: "CONFIRMED", to: "ORDERED", actorRole: "SELLER", ownsOrder: false,
    });
    assert.equal(codeOf(notOwner), "not_owner");

    const sellerDelivery = assertSupplierFulfilmentTransition({
      from: "IN_TRANSIT", to: "DELIVERED", actorRole: "SELLER", ownsOrder: true,
      deliveryEvidenceNote: "driver confirmed",
    });
    assert.equal(codeOf(sellerDelivery), "delivery_review_required");

    const adminNoEvidence = assertSupplierFulfilmentTransition({
      from: "IN_TRANSIT", to: "DELIVERED", actorRole: "ADMIN",
    });
    assert.equal(codeOf(adminNoEvidence), "delivery_evidence_required");

    const adminWithEvidence = assertSupplierFulfilmentTransition({
      from: "IN_TRANSIT", to: "DELIVERED", actorRole: "ADMIN",
      deliveryEvidenceNote: "courier delivery confirmation reviewed",
    });
    assert.equal(allowed(adminWithEvidence), true);
  });

  it("requires a reason for failure/cancellation and admin approval for retry", () => {
    const noReason = assertSupplierFulfilmentTransition({
      from: "CONFIRMED", to: "FAILED", actorRole: "SELLER", ownsOrder: true,
    });
    assert.equal(codeOf(noReason), "reason_required");

    const sellerCancel = assertSupplierFulfilmentTransition({
      from: "CONFIRMED", to: "CANCELLED", actorRole: "SELLER", ownsOrder: true,
      reason: "buyer cancelled",
    });
    assert.equal(codeOf(sellerCancel), "admin_cancel_required");

    const sellerRetry = assertSupplierFulfilmentTransition({
      from: "FAILED", to: "AWAITING_SUPPLIER_CONFIRMATION", actorRole: "SELLER", ownsOrder: true,
    });
    assert.equal(codeOf(sellerRetry), "admin_retry_required");

    const adminRetry = assertSupplierFulfilmentTransition({
      from: "FAILED", to: "AWAITING_SUPPLIER_CONFIRMATION", actorRole: "ADMIN", retryApproved: true,
    });
    assert.equal(allowed(adminRetry), true);
  });
});

describe("supplier return / payout hold rules", () => {
  it("enforces authorized return transitions", () => {
    assert.equal(allowed(assertSupplierReturnTransition({ from: "REQUESTED", to: "APPROVED", actorRole: "ADMIN" })), true);
    const buyerApprove = assertSupplierReturnTransition({ from: "REQUESTED", to: "APPROVED", actorRole: "BUYER", ownsRequest: true });
    assert.equal(codeOf(buyerApprove), "admin_only");
    assert.equal(allowed(assertSupplierReturnTransition({ from: "REQUESTED", to: "CANCELLED", actorRole: "BUYER", ownsRequest: true })), true);
    const shortcut = assertSupplierReturnTransition({ from: "APPROVED", to: "REFUND_PENDING", actorRole: "ADMIN" });
    assert.equal(codeOf(shortcut), "invalid_transition");
    assert.equal(allowed(assertSupplierReturnTransition({ from: "ITEM_RETURNED", to: "RESOLVED", actorRole: "ADMIN", resolutionNote: "Replacement sent" })), true);
    const missingNote = assertSupplierReturnTransition({ from: "ITEM_RETURNED", to: "RESOLVED", actorRole: "ADMIN" });
    assert.equal(codeOf(missingNote), "resolution_note_required");
  });

  it("does not resolve a refund-pending return without provider confirmation", () => {
    const pending = assertSupplierReturnTransition({
      from: "REFUND_PENDING", to: "RESOLVED", actorRole: "ADMIN",
      refundStatus: "PENDING", resolutionNote: "Refund requested",
    });
    assert.equal(codeOf(pending), "refund_not_confirmed");
    const completed = assertSupplierReturnTransition({
      from: "REFUND_PENDING", to: "RESOLVED", actorRole: "ADMIN",
      refundStatus: "COMPLETED", resolutionNote: "Provider confirmed refund",
    });
    assert.equal(allowed(completed), true);
  });

  it("maps return reasons onto the existing buyer-protection reasons", () => {
    assert.equal(mapReturnReasonToProtectionReason("DAMAGED"), "DAMAGED_ITEM");
    assert.equal(mapReturnReasonToProtectionReason("INCORRECT"), "WRONG_ITEM");
    assert.equal(mapReturnReasonToProtectionReason("UNDELIVERED"), "ITEM_NOT_RECEIVED");
    assert.equal(mapReturnReasonToProtectionReason("COUNTERFEIT"), "ITEM_NOT_AS_DESCRIBED");
  });

  it("holds payouts for open cases, unresolved returns and pending refunds only", () => {
    assert.equal(isSupplierPayoutHoldActive({ protectionCaseStatus: "OPEN" }), true);
    assert.equal(isSupplierPayoutHoldActive({ protectionCaseStatus: "UNDER_REVIEW" }), true);
    assert.equal(isSupplierPayoutHoldActive({ returnStatus: "REFUND_PENDING" }), true);
    assert.equal(isSupplierPayoutHoldActive({ refundStatus: "PROCESSING" }), true);
    assert.equal(
      isSupplierPayoutHoldActive({ protectionCaseStatus: "CLOSED", returnStatus: "RESOLVED", refundStatus: "COMPLETED" }),
      false,
    );
    assert.equal(isSupplierPayoutHoldActive({}), false);
  });
});
