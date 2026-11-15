import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRevenueReport, type RevenueDb } from "../revenue-service";

const FROM = new Date("2026-11-01T00:00:00Z");
const TO = new Date("2026-12-01T00:00:00Z");

type Pay = {
  orderId: string;
  provider: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
  order: Record<string, unknown>;
};

function order(id: string, status: string, over: Record<string, unknown> = {}) {
  return {
    id,
    orderNumber: `MH-${id}`,
    sellerId: "s1",
    status,
    deliveryFeeCents: 20_000,
    seller: { businessName: "Alpha" },
    items: [{ id: `${id}-i`, quantity: 1, unitPriceCents: 300_000, product: { categoryId: "c1" } }],
    refunds: [] as Array<{ amountCents: number }>,
    settlement: null as null | { providerFeeCents: number },
    ...over,
  };
}
const pay = (id: string, status: string, over: Partial<Pay> = {}, orderOver = {}): Pay => ({
  orderId: id,
  provider: "PAYSTACK",
  providerTransactionId: `tx-${id}`,
  paidAt: new Date("2026-11-10T09:00:00Z"),
  order: order(id, status, orderOver),
  ...over,
});

const RULE = {
  id: "r1", scope: "DEFAULT", sellerId: null, categoryId: null, type: "PERCENTAGE",
  percentageBps: 1000, fixedAmountCents: null, isActive: true,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
};

function fakeDb(payments: Pay[], rules: unknown[] = [RULE]) {
  const writes: string[] = [];
  const filters: unknown[] = [];
  const guard = (name: string) =>
    new Proxy({}, { get: (_t, prop) => { if (["create","update","updateMany","upsert","delete","deleteMany","createMany"].includes(String(prop))) return () => { writes.push(`${name}.${String(prop)}`); }; return undefined; } });
  const db = {
    payment: {
      findMany: async (args: { where: unknown }) => { filters.push(args.where); return payments; },
      ...(guard("payment") as object),
    },
    commissionRule: { findMany: async () => rules, ...(guard("commissionRule") as object) },
  } as unknown as RevenueDb;
  return { db, writes, filters };
}

describe("getRevenueReport", () => {
  it("builds the report from authoritative rows and is read-only", async () => {
    const { db, writes, filters } = fakeDb([pay("a", "COMPLETED"), pay("b", "SHIPPED")]);
    const { report, truncated } = await getRevenueReport(db, { from: FROM, to: TO });
    assert.equal(truncated, false);
    assert.equal(report.summary.grossMerchandiseSalesCents, 600_000);
    assert.equal(report.summary.commissionEarnedCents, 30_000);
    assert.equal(report.summary.pendingCommissionCents, 30_000);
    assert.equal(report.summary.deliveryChargesCents, 40_000);
    assert.deepEqual(writes, []);
    assert.deepEqual((filters[0] as { status: string }).status, "SUCCESS");
  });

  it("counts an order with two SUCCESS payments once and warns", async () => {
    const { db } = fakeDb([pay("a", "COMPLETED"), pay("a", "COMPLETED", { providerTransactionId: "tx-a-2" })]);
    const { report } = await getRevenueReport(db, { from: FROM, to: TO });
    assert.equal(report.summary.totalOrders, 1);
    assert.equal(report.summary.grossMerchandiseSalesCents, 300_000);
    assert.deepEqual(report.warnings.duplicatePaymentOrderIds, ["a"]);
  });

  it("applies only COMPLETED refunds supplied by the query and reverses commission", async () => {
    const { db } = fakeDb([pay("a", "COMPLETED", {}, { refunds: [{ amountCents: 100_000 }] })]);
    const { report } = await getRevenueReport(db, { from: FROM, to: TO });
    assert.equal(report.summary.commissionReversalsOnEarnedCents, 10_000);
    assert.equal(report.summary.netPlatformRevenueCents, 20_000);
  });

  it("reports provider fees only when a settlement recorded one", async () => {
    const { db } = fakeDb([
      pay("a", "COMPLETED", {}, { settlement: { providerFeeCents: 4_500 } }),
      pay("b", "COMPLETED", {}, { settlement: { providerFeeCents: 0 } }),
      pay("c", "COMPLETED"),
    ]);
    const { report } = await getRevenueReport(db, { from: FROM, to: TO });
    assert.equal(report.summary.paymentProcessingFeesCents, 4_500);
    assert.equal(report.summary.ordersWithProviderFeeData, 1);
    assert.equal(report.summary.ordersWithoutProviderFeeData, 2);
  });

  it("flags the missing commission configuration instead of inventing a rate", async () => {
    const { db } = fakeDb([pay("a", "COMPLETED")], []);
    const { report } = await getRevenueReport(db, { from: FROM, to: TO });
    assert.equal(report.warnings.hasDefaultRule, false);
    assert.deepEqual(report.warnings.unconfiguredCommissionOrderIds, ["a"]);
    assert.equal(report.summary.netPlatformRevenueCents, 0);
  });

  it("ignores payments without a paidAt and unpaid order states", async () => {
    const { db } = fakeDb([pay("a", "COMPLETED", { paidAt: null }), pay("b", "PENDING"), pay("c", "CANCELLED")]);
    const { report } = await getRevenueReport(db, { from: FROM, to: TO });
    assert.equal(report.summary.totalOrders, 0);
  });
});
