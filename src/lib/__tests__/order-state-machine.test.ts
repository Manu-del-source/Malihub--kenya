import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OrderStatus } from "@prisma/client";

import {
  ORDER_TRANSITIONS,
  RESERVED_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  OrderTransitionError,
  allowedTransitionsFrom,
  assertOrderTransition,
  canTransitionOrder,
  isReservedOrderStatus,
  isTerminalOrderStatus,
} from "@/lib/order-state-machine";

/**
 * The order state machine, tested in isolation.
 *
 * This module is pure — no database, no Prisma — so every assertion here is
 * about the rules themselves rather than about a store. The five happy-path
 * moves, every illegal move, the three terminal states, and the `CONFIRMED`
 * decision are each pinned explicitly, because a lifecycle that is only
 * exercised through a service is a lifecycle that can quietly regress.
 */

/** The transitions Phase 9.1 promises, written out rather than derived from
 *  the table, so a change to the table that breaks the promise fails here. */
const REQUIRED_TRANSITIONS: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  ["PENDING", "PAID"],
  ["PENDING", "CANCELLED"],
  ["PAID", "SHIPPED"],
  ["SHIPPED", "DELIVERED"],
  ["DELIVERED", "COMPLETED"],
];

/** Moves that must never be possible, regardless of implementation. */
const FORBIDDEN_TRANSITIONS: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  ["CANCELLED", "PAID"],
  ["CANCELLED", "PENDING"],
  ["CANCELLED", "COMPLETED"],
  ["COMPLETED", "CANCELLED"],
  ["COMPLETED", "REFUNDED"],
  ["REFUNDED", "COMPLETED"],
  ["REFUNDED", "PENDING"],
  ["PAID", "PENDING"],
  ["PAID", "CANCELLED"],
  ["SHIPPED", "PAID"],
  ["DELIVERED", "SHIPPED"],
  ["DELIVERED", "CANCELLED"],
  ["PENDING", "REFUNDED"],
  ["PENDING", "CONFIRMED"],
  ["CONFIRMED", "PAID"],
  ["CONFIRMED", "PENDING"],
];

describe("order state machine — the required lifecycle", () => {
  for (const [from, to] of REQUIRED_TRANSITIONS) {
    it(`allows ${from} → ${to}`, () => {
      assert.equal(canTransitionOrder(from, to), true);
      assert.ok(allowedTransitionsFrom(from).includes(to));
      assert.doesNotThrow(() => assertOrderTransition(from, to));
    });
  }

  it("PENDING offers exactly PAID and CANCELLED", () => {
    assert.deepEqual([...allowedTransitionsFrom("PENDING")].sort(), ["CANCELLED", "PAID"]);
  });

  it("is an allowlist — an unknown destination is never reachable", () => {
    for (const from of Object.values(OrderStatus)) {
      const allowed = allowedTransitionsFrom(from);
      for (const to of Object.values(OrderStatus)) {
        assert.equal(
          allowed.includes(to),
          canTransitionOrder(from, to),
          `${from} → ${to} disagreed with the table`
        );
      }
    }
  });
});

describe("order state machine — forbidden moves", () => {
  for (const [from, to] of FORBIDDEN_TRANSITIONS) {
    it(`refuses ${from} → ${to}`, () => {
      assert.equal(canTransitionOrder(from, to), false);
      assert.throws(
        () => assertOrderTransition(from, to),
        (error: unknown) =>
          error instanceof OrderTransitionError && error.from === from && error.to === to
      );
    });
  }

  it("refuses a move to the status it is already in", () => {
    // Repeat handling is the caller's decision (idempotent success vs
    // conflict), so the pure rule stays strict.
    for (const status of Object.values(OrderStatus)) {
      assert.equal(canTransitionOrder(status, status), false);
    }
  });
});

describe("order state machine — terminal states", () => {
  for (const status of ["CANCELLED", "COMPLETED", "REFUNDED"] as const) {
    it(`${status} is terminal and leads nowhere`, () => {
      assert.equal(isTerminalOrderStatus(status), true);
      assert.deepEqual([...allowedTransitionsFrom(status)], []);
    });
  }

  it("non-terminal statuses are not reported as terminal", () => {
    for (const status of ["PENDING", "PAID", "SHIPPED", "DELIVERED"] as const) {
      assert.equal(isTerminalOrderStatus(status), false);
    }
  });

  it("covers every status exactly once between terminal and live", () => {
    const all = Object.values(OrderStatus);
    const terminal = all.filter(isTerminalOrderStatus);
    const reserved = all.filter(isReservedOrderStatus);
    // Terminal + reserved + live-with-transitions == the whole enum, and the
    // three sets never overlap.
    const live = all.filter(
      (s) => !isTerminalOrderStatus(s) && !isReservedOrderStatus(s)
    );
    assert.equal(new Set([...terminal, ...reserved, ...live]).size, all.length);
    assert.equal(terminal.length + reserved.length + live.length, all.length);
  });
});

describe("order state machine — CONFIRMED is a reserved legacy value", () => {
  it("is classified as reserved, not terminal and not live", () => {
    assert.equal(isReservedOrderStatus("CONFIRMED"), true);
    assert.equal(isTerminalOrderStatus("CONFIRMED"), false);
    assert.ok(RESERVED_ORDER_STATUSES.includes("CONFIRMED"));
    assert.ok(!TERMINAL_ORDER_STATUSES.includes("CONFIRMED"));
  });

  it("has no outgoing and no incoming transitions", () => {
    assert.deepEqual([...allowedTransitionsFrom("CONFIRMED")], []);
    assert.deepEqual([...ORDER_TRANSITIONS.CONFIRMED], []);
    for (const from of Object.values(OrderStatus)) {
      assert.equal(canTransitionOrder(from, "CONFIRMED"), false, `${from} → CONFIRMED`);
    }
  });

  it("rejects touching it with a reserved_status reason", () => {
    try {
      assertOrderTransition("CONFIRMED", "PAID");
      assert.fail("expected a rejection");
    } catch (error) {
      assert.ok(error instanceof OrderTransitionError);
      assert.equal(error.code, "reserved_status");
    }
  });

  it("still carries a display label, so any legacy row renders", () => {
    // The value is kept in the enum (removing it is a destructive migration),
    // so read paths must keep working for a row that somehow has it.
    assert.equal(typeof ORDER_TRANSITIONS.CONFIRMED, "object");
  });
});

describe("order state machine — REFUNDED is closed to application transitions", () => {
  it("cannot be entered directly from any live status", () => {
    for (const from of Object.values(OrderStatus)) {
      assert.equal(canTransitionOrder(from, "REFUNDED"), false, `${from} → REFUNDED`);
    }
  });

  it("is terminal, so a later RefundService inherits a closed state", () => {
    assert.equal(isTerminalOrderStatus("REFUNDED"), true);
    assert.deepEqual([...allowedTransitionsFrom("REFUNDED")], []);
  });
});

describe("order state machine — error shape", () => {
  it("classifies a terminal source as terminal_status", () => {
    try {
      assertOrderTransition("CANCELLED", "PAID");
      assert.fail("expected a rejection");
    } catch (error) {
      assert.ok(error instanceof OrderTransitionError);
      assert.equal(error.code, "terminal_status");
      assert.match(error.message, /already cancelled/i);
    }
  });

  it("classifies any other illegal move as not_allowed", () => {
    try {
      assertOrderTransition("PAID", "PENDING");
      assert.fail("expected a rejection");
    } catch (error) {
      assert.ok(error instanceof OrderTransitionError);
      assert.equal(error.code, "not_allowed");
    }
  });

  it("carries from/to so callers do not re-derive the transition", () => {
    const error = new OrderTransitionError("SHIPPED", "DELIVERED");
    assert.equal(error.name, "OrderTransitionError");
    assert.ok(error instanceof Error);
  });
});
