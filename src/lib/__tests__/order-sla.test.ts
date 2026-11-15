import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_DISPATCH_SLA_HOURS, dispatchSlaHours, isDispatchOverdue } from "../order-sla";

const NOW = new Date("2026-11-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("dispatch SLA monitoring", () => {
  it("is overdue only when PAID and paid longer ago than the SLA", () => {
    assert.equal(isDispatchOverdue("PAID", hoursAgo(49), NOW, 48), true);
    assert.equal(isDispatchOverdue("PAID", hoursAgo(47), NOW, 48), false);
  });
  it("never flags unpaid, shipped or finished orders, or a missing paid time", () => {
    for (const status of ["PENDING", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"]) {
      assert.equal(isDispatchOverdue(status, hoursAgo(500), NOW, 48), false, status);
    }
    assert.equal(isDispatchOverdue("PAID", null, NOW, 48), false);
  });
  it("reads ORDER_DISPATCH_SLA_HOURS safely and falls back to the default", () => {
    assert.equal(dispatchSlaHours("24"), 24);
    for (const bad of [undefined, "", "0", "-5", "1.5", "abc", "99999"]) {
      assert.equal(dispatchSlaHours(bad), DEFAULT_DISPATCH_SLA_HOURS, String(bad));
    }
  });
});
