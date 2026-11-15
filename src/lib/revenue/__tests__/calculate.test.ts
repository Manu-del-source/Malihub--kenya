import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRevenueReport,
  calculateOrderRevenue,
  divHalfUp,
  resolveCommissionRule,
  type CommissionRuleInput,
  type OrderStatusName,
  type RevenueOrderInput,
} from "../calculate";

const T0 = new Date("2026-01-01T00:00:00Z");
const PAID_AT = new Date("2026-11-10T09:00:00Z");

const rule = (over: Partial<CommissionRuleInput> = {}): CommissionRuleInput => ({
  id: "rule-default",
  scope: "DEFAULT",
  sellerId: null,
  categoryId: null,
  type: "PERCENTAGE",
  percentageBps: 1000, // 10.00% — a TEST fixture, not a platform rate
  fixedAmountCents: null,
  isActive: true,
  effectiveFrom: T0,
  effectiveTo: null,
  ...over,
});

let n = 0;
const order = (over: Partial<RevenueOrderInput> = {}): RevenueOrderInput => {
  n += 1;
  return {
    orderId: `o${n}`,
    orderNumber: `MH-${n}`,
    sellerId: "s1",
    sellerName: "Seller One",
    status: "COMPLETED" as OrderStatusName,
    paidAt: PAID_AT,
    provider: "PAYSTACK",
    providerTransactionId: `tx${n}`,
    items: [{ id: `i${n}`, categoryId: "c1", unitPriceCents: 300_000, quantity: 1 }], // KSh 3,000
    deliveryFeeCents: 0,
    completedRefundCents: 0,
    providerFeeCents: null,
    ...over,
  };
};

describe("commission and seller earnings", () => {
  it("KSh 3,000 × 1 at 10% → commission KSh 300, seller KSh 2,700", () => {
    const l = calculateOrderRevenue(order(), [rule()]);
    assert.equal(l.merchandiseCents, 300_000);
    assert.equal(l.commissionCents, 30_000);
    assert.equal(l.sellerShareCents, 270_000);
    assert.equal(l.commissionCents + l.sellerShareCents, l.merchandiseCents);
  });

  it("excludes delivery charges from commissionable merchandise and reports them separately", () => {
    const r = buildRevenueReport([order({ deliveryFeeCents: 25_000 })], [rule()]);
    assert.equal(r.summary.grossMerchandiseSalesCents, 300_000);
    assert.equal(r.summary.commissionEarnedCents, 30_000);
    assert.equal(r.summary.deliveryChargesCents, 25_000);
    assert.equal(r.summary.netPlatformRevenueCents, 30_000, "delivery must not become platform revenue");
  });

  it("multiplies price by quantity and rounds half-up in integer cents", () => {
    // 3 × 1,001 cents = 3,003 × 10% = 300.3 → 300 ; 5 cents × 10% = 0.5 → 1 (half-up)
    const a = calculateOrderRevenue(order({ items: [{ id: "a", categoryId: "c1", unitPriceCents: 1001, quantity: 3 }] }), [rule()]);
    assert.equal(a.commissionCents, 300);
    const b = calculateOrderRevenue(order({ items: [{ id: "b", categoryId: "c1", unitPriceCents: 5, quantity: 1 }] }), [rule()]);
    assert.equal(b.commissionCents, 1);
    assert.equal(divHalfUp(5, 10), 1);
  });

  it("uses decimal-safe integers: no float drift on awkward amounts", () => {
    const l = calculateOrderRevenue(order({ items: [{ id: "x", categoryId: "c1", unitPriceCents: 1_999_999, quantity: 7 }] }), [rule({ percentageBps: 333 })]);
    assert.ok(Number.isSafeInteger(l.commissionCents));
    assert.equal(l.commissionCents + l.sellerShareCents, l.merchandiseCents);
  });
});

describe("rule configuration", () => {
  it("SELLER beats CATEGORY beats DEFAULT; latest effectiveFrom wins within a scope", () => {
    const rules = [
      rule({ id: "d", percentageBps: 1000 }),
      rule({ id: "c", scope: "CATEGORY", categoryId: "c1", percentageBps: 800 }),
      rule({ id: "s", scope: "SELLER", sellerId: "s1", percentageBps: 500 }),
      rule({ id: "d2", percentageBps: 1200, effectiveFrom: new Date("2026-06-01T00:00:00Z") }),
    ];
    assert.equal(resolveCommissionRule(rules, "s1", "c1", PAID_AT)?.id, "s");
    assert.equal(resolveCommissionRule(rules, "s2", "c1", PAID_AT)?.id, "c");
    assert.equal(resolveCommissionRule(rules, "s2", "c9", PAID_AT)?.id, "d2");
  });

  it("ignores inactive and not-yet-effective / expired rules", () => {
    assert.equal(resolveCommissionRule([rule({ isActive: false })], "s1", "c1", PAID_AT), null);
    assert.equal(resolveCommissionRule([rule({ effectiveFrom: new Date("2027-01-01T00:00:00Z") })], "s1", "c1", PAID_AT), null);
    assert.equal(resolveCommissionRule([rule({ effectiveTo: new Date("2026-02-01T00:00:00Z") })], "s1", "c1", PAID_AT), null);
  });

  it("with no configured rule, commission is NOT silently 0%: the order is flagged", () => {
    const r = buildRevenueReport([order()], []);
    assert.deepEqual(r.warnings.unconfiguredCommissionOrderIds, ["o" + n]);
    assert.equal(r.warnings.hasDefaultRule, false);
    assert.equal(r.summary.commissionEarnedCents, 0);
    assert.equal(r.summary.sellerEarningsPayableCents, 0, "seller share is unknown without a rate");
    assert.equal(r.summary.grossMerchandiseSalesCents, 300_000, "sale is still a sale");
  });

  it("clamps a fixed commission to the merchandise it applies to", () => {
    const l = calculateOrderRevenue(order({ items: [{ id: "f", categoryId: "c1", unitPriceCents: 20_000, quantity: 1 }] }), [
      rule({ type: "FIXED", percentageBps: null, fixedAmountCents: 50_000 }),
    ]);
    assert.equal(l.commissionCents, 20_000);
    assert.equal(l.sellerShareCents, 0);
  });
});

describe("pending versus earned commission", () => {
  it("only COMPLETED orders earn; PAID/SHIPPED/DELIVERED stay pending", () => {
    const r = buildRevenueReport(
      (["PAID", "SHIPPED", "DELIVERED", "COMPLETED"] as OrderStatusName[]).map((status) => order({ status })),
      [rule()]
    );
    assert.equal(r.summary.commissionEarnedCents, 30_000);
    assert.equal(r.summary.pendingCommissionCents, 90_000);
    assert.equal(r.summary.completedMerchandiseSalesCents, 300_000);
    assert.equal(r.summary.grossMerchandiseSalesCents, 1_200_000);
    assert.equal(r.summary.sellerEarningsPayableCents, 270_000);
    assert.equal(r.summary.sellerEarningsPendingCents, 810_000);
  });

  it("does not count unpaid, cancelled or reserved orders as sales", () => {
    const r = buildRevenueReport(
      (["PENDING", "CONFIRMED", "CANCELLED"] as OrderStatusName[]).map((status) => order({ status })),
      [rule()]
    );
    assert.equal(r.summary.totalOrders, 0);
    assert.equal(r.summary.grossMerchandiseSalesCents, 0);
    assert.equal(r.summary.averageOrderValueCents, null);
  });
});

describe("refunds and commission reversals", () => {
  it("full refund reverses the whole commission; net platform revenue is zero", () => {
    const r = buildRevenueReport([order({ completedRefundCents: 300_000 })], [rule()]);
    assert.equal(r.summary.commissionEarnedCents, 30_000);
    assert.equal(r.summary.commissionReversalsOnEarnedCents, 30_000);
    assert.equal(r.summary.netPlatformRevenueCents, 0);
    assert.equal(r.summary.refundsCents, 300_000);
    assert.equal(r.summary.sellerEarningsPayableCents, 0);
  });

  it("partial refund reverses commission proportionally (KSh 1,000 of 3,000 → KSh 100)", () => {
    const l = calculateOrderRevenue(order({ completedRefundCents: 100_000 }), [rule()]);
    assert.equal(l.commissionReversalCents, 10_000);
    assert.equal(l.netCommissionCents, 20_000);
    assert.equal(l.netSellerShareCents, 180_000);
    assert.equal(l.netCommissionCents + l.netSellerShareCents + l.refundedMerchandiseCents, l.merchandiseCents);
  });

  it("a partial refund on a pending order reduces pending commission, not net revenue", () => {
    const r = buildRevenueReport([order({ status: "SHIPPED", completedRefundCents: 150_000 })], [rule()]);
    assert.equal(r.summary.pendingCommissionCents, 15_000);
    assert.equal(r.summary.netPlatformRevenueCents, 0);
    assert.equal(r.summary.commissionReversalsCents, 15_000);
  });

  it("a REFUNDED order contributes nothing to earned or pending commission", () => {
    const r = buildRevenueReport([order({ status: "REFUNDED" })], [rule()]);
    assert.equal(r.summary.commissionEarnedCents, 0);
    assert.equal(r.summary.pendingCommissionCents, 0);
    assert.equal(r.summary.netPlatformRevenueCents, 0);
    assert.equal(r.summary.commissionReversalsCents, 30_000);
  });

  it("never reverses more than the merchandise even if the refund includes delivery", () => {
    const l = calculateOrderRevenue(order({ deliveryFeeCents: 25_000, completedRefundCents: 325_000 }), [rule()]);
    assert.equal(l.refundedMerchandiseCents, 300_000);
    assert.equal(l.commissionReversalCents, 30_000);
  });
});

describe("payment processing fees", () => {
  it("are reported separately from actual data and never silently deducted", () => {
    const r = buildRevenueReport(
      [order({ providerFeeCents: 4_500 }), order({ providerFeeCents: null })],
      [rule()]
    );
    assert.equal(r.summary.paymentProcessingFeesCents, 4_500);
    assert.equal(r.summary.ordersWithProviderFeeData, 1);
    assert.equal(r.summary.ordersWithoutProviderFeeData, 1);
    assert.equal(r.summary.commissionEarnedCents, 60_000, "fees do not reduce commission");
    assert.equal(r.summary.netPlatformRevenueCents, 60_000);
  });
});

describe("no duplicate counting", () => {
  it("counts one order once even if it is supplied twice", () => {
    const o = order();
    const r = buildRevenueReport([o, { ...o }], [rule()]);
    assert.equal(r.summary.totalOrders, 1);
    assert.equal(r.summary.grossMerchandiseSalesCents, 300_000);
  });

  it("counts one provider transaction once even if two order rows reference it", () => {
    const a = order({ providerTransactionId: "dup-tx" });
    const b = order({ providerTransactionId: "dup-tx" });
    const r = buildRevenueReport([a, b], [rule()]);
    assert.equal(r.summary.totalOrders, 1);
  });
});

describe("multi-seller", () => {
  it("splits into per-seller orders without double counting and with correct breakdowns", () => {
    const orders = [
      order({ sellerId: "s1", sellerName: "Alpha", items: [{ id: "1", categoryId: "c1", unitPriceCents: 300_000, quantity: 1 }] }),
      order({ sellerId: "s2", sellerName: "Beta", items: [{ id: "2", categoryId: "c1", unitPriceCents: 100_000, quantity: 2 }] }),
    ];
    const r = buildRevenueReport(orders, [rule(), rule({ id: "s2-rule", scope: "SELLER", sellerId: "s2", percentageBps: 500 })]);
    assert.equal(r.summary.grossMerchandiseSalesCents, 500_000);
    assert.equal(r.summary.commissionEarnedCents, 30_000 + 10_000);
    const alpha = r.bySeller.find((x) => x.label === "Alpha")!;
    const beta = r.bySeller.find((x) => x.label === "Beta")!;
    assert.equal(alpha.netCommissionCents, 30_000);
    assert.equal(beta.netCommissionCents, 10_000);
    assert.equal(alpha.netCommissionCents + beta.netCommissionCents, r.summary.netPlatformRevenueCents);
    assert.equal(r.summary.averageOrderValueCents, 250_000);
  });

  it("breakdown rows always sum to the headline totals", () => {
    const r = buildRevenueReport(
      [order({ provider: "PAYSTACK" }), order({ provider: "MPESA", status: "SHIPPED" }), order({ status: "DELIVERED" })],
      [rule()]
    );
    for (const rows of [r.bySeller, r.byProvider, r.byStatus]) {
      assert.equal(rows.reduce((t, x) => t + x.merchandiseCents, 0), r.summary.grossMerchandiseSalesCents);
      assert.equal(rows.reduce((t, x) => t + x.orders, 0), r.summary.totalOrders);
    }
  });
});

describe("input validation", () => {
  it("rejects non-integer or negative money rather than guessing", () => {
    assert.throws(() => calculateOrderRevenue(order({ deliveryFeeCents: 1.5 }), [rule()]), RangeError);
    assert.throws(() => calculateOrderRevenue(order({ items: [{ id: "x", categoryId: "c", unitPriceCents: -1, quantity: 1 }] }), [rule()]), RangeError);
    assert.throws(() => calculateOrderRevenue(order({ items: [{ id: "x", categoryId: "c", unitPriceCents: 100, quantity: 0 }] }), [rule()]), RangeError);
  });
});
