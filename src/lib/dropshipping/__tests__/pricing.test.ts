import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBasisPoints,
  calculateDropshippingPricing,
  PricingError,
  resolveCommissionRule,
  type CommissionRuleLike,
} from "../pricing";

const base = {
  retailPriceCents: 250_000,
  supplierCostMinor: 150_000,
  supplierDeliveryChargeMinor: 5_000,
  sellerFulfilmentCostCents: 2_000,
  commission: { id: "rule-1", scope: "DEFAULT" as const, type: "PERCENTAGE" as const, percentageBps: 500, fixedAmountCents: 0 },
  paymentFeeBps: 150,
  taxBps: 0,
  currency: "KES",
  costVerified: true,
  deliveryChargeVerified: true,
  feeConfigVerified: true,
  configVersion: "test-v1",
};

describe("dropshipping pricing — exact integer KES arithmetic", () => {
  it("computes fees, cost, gross profit and margin without floating point drift", () => {
    const b = calculateDropshippingPricing(base);
    assert.equal(b.platformFeeCents, 12_500); // 5% of 250000
    assert.equal(b.paymentFeeCents, 3_750); // 1.5% of 250000
    assert.equal(b.taxCents, 0);
    assert.equal(b.estimatedCostCents, 173_250);
    assert.equal(b.estimatedGrossProfitCents, 76_750);
    assert.equal(b.marginBps, 3_070); // 30.70%
    assert.equal(b.isEstimate, false);
    assert.deepEqual(b.warnings, []);
  });

  it("applies basis points with half-up rounding on integer cents", () => {
    assert.equal(applyBasisPoints(1, 5_000), 1);
    assert.equal(applyBasisPoints(1, 4_999), 0);
    assert.equal(applyBasisPoints(3, 5_000), 2);
    assert.equal(applyBasisPoints(999, 250), 25);
  });

  it("rejects negative, zero, fractional and out-of-range money values", () => {
    assert.throws(() => calculateDropshippingPricing({ ...base, retailPriceCents: 0 }), PricingError);
    assert.throws(() => calculateDropshippingPricing({ ...base, supplierCostMinor: -1 }), PricingError);
    assert.throws(() => calculateDropshippingPricing({ ...base, sellerFulfilmentCostCents: 1.5 }), PricingError);
    assert.throws(
      () => calculateDropshippingPricing({ ...base, retailPriceCents: 2_000_000_001 }),
      PricingError,
    );
  });

  it("never invents an FX rate for a foreign-currency supplier cost", () => {
    assert.throws(
      () => calculateDropshippingPricing({ ...base, currency: "USD" }),
      (error: unknown) => error instanceof PricingError && error.code === "unsupported_currency",
    );
  });

  it("flags every unverified input as an estimate and reports negative profit", () => {
    const b = calculateDropshippingPricing({
      ...base,
      retailPriceCents: 100_000,
      costVerified: false,
      deliveryChargeVerified: false,
      feeConfigVerified: false,
      commission: { id: null, scope: "NONE", type: "NONE", percentageBps: 0, fixedAmountCents: 0 },
      configWarnings: ["payment_fee_unconfigured"],
    });
    assert.equal(b.isEstimate, true);
    assert.ok(b.estimatedGrossProfitCents < 0);
    assert.ok(b.marginBps < 0);
    assert.ok(b.warnings.includes("supplier_cost_unverified"));
    assert.ok(b.warnings.includes("platform_fee_unconfigured"));
    assert.ok(b.warnings.includes("payment_fee_unconfigured"));
    assert.ok(b.warnings.includes("negative_estimated_profit"));
  });
});

describe("commission rule resolution reuses the existing precedence", () => {
  const rule = (overrides: Partial<CommissionRuleLike>): CommissionRuleLike => ({
    id: "default",
    scope: "DEFAULT",
    type: "PERCENTAGE",
    percentageBps: 500,
    isActive: true,
    ...overrides,
  });

  it("prefers an active seller rule over category and default rules", () => {
    const resolved = resolveCommissionRule(
      [
        rule({ id: "default" }),
        rule({ id: "category", scope: "CATEGORY", categoryId: "cat-1", percentageBps: 700 }),
        rule({ id: "seller", scope: "SELLER", sellerId: "seller-1", percentageBps: 300 }),
      ],
      { sellerId: "seller-1", categoryId: "cat-1" },
    );
    assert.equal(resolved.id, "seller");
    assert.equal(resolved.percentageBps, 300);
  });

  it("honours fixed rules, inactive rules and effective date windows", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    const rules = [
      rule({ id: "expired", scope: "SELLER", sellerId: "seller-1", effectiveTo: new Date("2026-01-01T00:00:00Z") }),
      rule({ id: "inactive", scope: "SELLER", sellerId: "seller-1", isActive: false }),
      rule({ id: "future", scope: "CATEGORY", categoryId: "cat-1", effectiveFrom: new Date("2027-01-01T00:00:00Z") }),
      rule({ id: "fixed", type: "FIXED", fixedAmountCents: 1_250, percentageBps: null }),
    ];
    const resolved = resolveCommissionRule(rules, { sellerId: "seller-1", categoryId: "cat-1", now });
    assert.equal(resolved.id, "fixed");
    assert.equal(resolved.type, "FIXED");
    assert.equal(resolved.fixedAmountCents, 1_250);
  });

  it("returns zero with no configured rule instead of inventing a fee", () => {
    const resolved = resolveCommissionRule([], { sellerId: "seller-1" });
    assert.equal(resolved.scope, "NONE");
    assert.equal(resolved.percentageBps, 0);
  });
});
