import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPaymentTransition,
  canPaymentTransition,
  CLAIMABLE_PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  PaymentTransitionError,
  TERMINAL_PAYMENT_STATUSES,
} from "@/lib/payment-state-machine";

/**
 * The payment-attempt lifecycle rules, in their purest form. Everything else
 * in Phase 9.3 (conditional claims, advisory lock, sibling guard) is
 * enforcement machinery around exactly the table asserted here.
 */

const ALL = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"] as const;

describe("payment-state-machine — the transition table", () => {
  it("covers every PaymentStatus in the enum exactly once", () => {
    assert.deepEqual(Object.keys(PAYMENT_TRANSITIONS).sort(), [...ALL].sort());
  });

  it("PENDING may go to PROCESSING, SUCCESS, FAILED, CANCELLED — nothing else", () => {
    assert.deepEqual([...PAYMENT_TRANSITIONS.PENDING].sort(), [
      "CANCELLED",
      "FAILED",
      "PROCESSING",
      "SUCCESS",
    ]);
  });

  it("PROCESSING may settle or die — but never go back or sideways", () => {
    assert.deepEqual([...PAYMENT_TRANSITIONS.PROCESSING].sort(), ["CANCELLED", "FAILED", "SUCCESS"]);
    assert.equal(canPaymentTransition("PROCESSING", "PENDING"), false);
    assert.equal(canPaymentTransition("PROCESSING", "PROCESSING"), false);
    assert.equal(canPaymentTransition("PROCESSING", "REFUNDED"), false);
  });

  it("SUCCESS is terminal: it can never be rewritten, downgraded, or revoked", () => {
    for (const to of ALL) assert.equal(canPaymentTransition("SUCCESS", to), false, `SUCCESS → ${to}`);
  });

  it("FAILED is terminal: a late success must never resurrect an attempt (FAILED → SUCCESS)", () => {
    for (const to of ALL) assert.equal(canPaymentTransition("FAILED", to), false, `FAILED → ${to}`);
    // The explicit spec guard, named:
    assert.equal(canPaymentTransition("FAILED", "SUCCESS"), false);
  });

  it("CANCELLED is terminal: cancelling the STK prompt ends the attempt, not the order", () => {
    for (const to of ALL) assert.equal(canPaymentTransition("CANCELLED", to), false, `CANCELLED → ${to}`);
  });

  it("REFUNDED is terminal and un-enterable from collection states", () => {
    for (const to of ALL) assert.equal(canPaymentTransition("REFUNDED", to), false, `REFUNDED → ${to}`);
    for (const from of ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED"] as const) {
      assert.equal(
        canPaymentTransition(from, "REFUNDED"),
        false,
        `${from} → REFUNDED belongs to the refund phase, not collection`
      );
    }
  });

  it("the terminal set and the claimable set partition the lifecycle", () => {
    assert.deepEqual([...TERMINAL_PAYMENT_STATUSES].sort(), [
      "CANCELLED",
      "FAILED",
      "REFUNDED",
      "SUCCESS",
    ]);
    assert.deepEqual([...CLAIMABLE_PAYMENT_STATUSES].sort(), ["PENDING", "PROCESSING"]);
    for (const status of ALL) {
      const isTerminal = TERMINAL_PAYMENT_STATUSES.includes(status);
      const isClaimable = CLAIMABLE_PAYMENT_STATUSES.includes(status);
      assert.notEqual(isTerminal, isClaimable, `${status} is exactly one of the two`);
    }
  });

  it("assertPaymentTransition explains illegal moves, and every illegal pair throws", () => {
    let checked = 0;
    for (const from of ALL) {
      for (const to of ALL) {
        const legal = canPaymentTransition(from, to);
        if (legal) {
          assert.doesNotThrow(() => assertPaymentTransition(from, to));
        } else {
          assert.throws(() => assertPaymentTransition(from, to), PaymentTransitionError);
        }
        checked += 1;
      }
    }
    assert.equal(checked, ALL.length * ALL.length);

    const error = new PaymentTransitionError("SUCCESS", "FAILED");
    assert.match(error.message, /terminal/);
    assert.equal(error.from, "SUCCESS");
    assert.equal(error.to, "FAILED");
  });
});
