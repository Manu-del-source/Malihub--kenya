import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrderProgress, orderProgressHeadline } from "../order-progress";

const createdAt = new Date("2026-11-11T08:00:00Z");
const deliveredAt = new Date("2026-11-15T10:00:00Z");

const flags = (status: Parameters<typeof buildOrderProgress>[0]["status"], extra = {}) => {
  const p = buildOrderProgress({ status, createdAt, ...extra });
  assert.equal(p.kind, "steps");
  return p.kind === "steps" ? p.steps.map((s) => s.done) : [];
};

describe("buildOrderProgress", () => {
  it("PENDING: only placed is done, awaiting payment", () => {
    assert.deepEqual(flags("PENDING"), [true, false, false, false]);
    assert.equal(orderProgressHeadline(buildOrderProgress({ status: "PENDING", createdAt })), "Awaiting payment");
  });

  it("PAID and SHIPPED advance the steps", () => {
    assert.deepEqual(flags("PAID"), [true, true, false, false]);
    assert.deepEqual(flags("SHIPPED"), [true, true, true, false]);
    assert.equal(orderProgressHeadline(buildOrderProgress({ status: "SHIPPED", createdAt })), "On the way");
  });

  it("DELIVERED without a verified deliveredAt does not mark delivered", () => {
    assert.deepEqual(flags("DELIVERED"), [true, true, true, false]);
  });

  it("delivered needs deliveredAt, and shows its date", () => {
    const p = buildOrderProgress({ status: "DELIVERED", createdAt, deliveredAt });
    assert.equal(p.kind === "steps" && p.steps.every((s) => s.done), true);
    assert.equal(p.kind === "steps" && p.steps[3]?.at, deliveredAt);
    assert.equal(orderProgressHeadline(p), "Delivered");
  });

  it("CANCELLED and REFUNDED have no steps", () => {
    assert.deepEqual(buildOrderProgress({ status: "CANCELLED", createdAt }), { kind: "closed", label: "Cancelled" });
    assert.deepEqual(buildOrderProgress({ status: "REFUNDED", createdAt }), { kind: "closed", label: "Refunded" });
  });
});
