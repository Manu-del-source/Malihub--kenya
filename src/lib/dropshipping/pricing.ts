/**
 * Dropshipping cost and gross-profit calculator.
 *
 * ─── Money rules ────────────────────────────────────────────────────────────
 * All amounts are integer KES cents and all rates are integer basis points.
 * The arithmetic is BigInt end-to-end, so a 5% fee on 1 cent, a margin on a
 * negative profit, or a repeated recalculation can never accumulate floating
 * point error. Percentages round HALF UP once, at the point they are applied.
 *
 * ─── What this deliberately does NOT decide ────────────────────────────────
 * No tax rate, payment-processor rate, commission rate or supplier price is
 * hard-coded. Platform commission comes from the existing `CommissionRule`
 * table (resolved by `resolveCommissionRule`); payment fee and tax come from
 * server configuration; seller fulfilment cost comes from the seller. Missing
 * values are zero AND reported as warnings with `isEstimate: true`. A seller
 * sets their own retail price — this module never reprices a listing.
 */

export type CommissionRuleLike = {
  id: string;
  scope: "DEFAULT" | "SELLER" | "CATEGORY";
  sellerId?: string | null;
  categoryId?: string | null;
  type: "PERCENTAGE" | "FIXED";
  percentageBps?: number | null;
  fixedAmountCents?: number | null;
  isActive?: boolean | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
};

export type ResolvedCommissionRule = {
  id: string | null;
  scope: "DEFAULT" | "SELLER" | "CATEGORY" | "NONE";
  type: "PERCENTAGE" | "FIXED" | "NONE";
  percentageBps: number;
  fixedAmountCents: number;
};

export type PricingInput = {
  retailPriceCents: number;
  supplierCostMinor: number;
  supplierDeliveryChargeMinor: number | null;
  sellerFulfilmentCostCents: number;
  commission: ResolvedCommissionRule;
  paymentFeeBps: number;
  taxBps: number;
  currency: string;
  costVerified: boolean;
  deliveryChargeVerified: boolean;
  feeConfigVerified: boolean;
  configVersion: string;
  /** Present when the fee/tax config is missing; merged into warnings. */
  configWarnings?: readonly string[];
};

export type PricingBreakdown = {
  currency: "KES";
  retailPriceCents: number;
  supplierCostCents: number;
  supplierDeliveryCents: number;
  sellerFulfilmentCents: number;
  platformFeeCents: number;
  paymentFeeCents: number;
  taxCents: number;
  estimatedCostCents: number;
  estimatedGrossProfitCents: number;
  /** Gross-profit margin in basis points. Can be negative. */
  marginBps: number;
  commissionRuleId: string | null;
  commissionScope: ResolvedCommissionRule["scope"];
  isEstimate: boolean;
  configVersion: string;
  warnings: string[];
};

export class PricingError extends Error {
  readonly code: "invalid_money" | "unsupported_currency" | "invalid_rate";

  constructor(message: string, code: PricingError["code"]) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

/** 2_000_000_000 matches the existing product price validation ceiling. */
export const MAX_MONEY_CENTS = 2_000_000_000;

function money(value: number, label: string, allowZero = true): bigint {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_MONEY_CENTS) {
    throw new PricingError(`${label} must be an integer${allowZero ? "" : " greater than zero"} in cents.`, "invalid_money");
  }
  return BigInt(value);
}

function rate(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new PricingError(`${label} must be an integer between 0 and 10000 basis points.`, "invalid_rate");
  }
  return BigInt(value);
}

/** Half-up application of basis points: 1 cent at 50% becomes 1 cent. */
export function applyBasisPoints(amountCents: number, bps: number): number {
  const amount = money(amountCents, "amount");
  const applied = (amount * rate(bps, "bps") + 5_000n) / 10_000n;
  if (applied > BigInt(MAX_MONEY_CENTS)) {
    throw new PricingError("A fee would exceed the supported money range.", "invalid_money");
  }
  return Number(applied);
}

/**
 * Reuses MaliHub's existing commission precedence: active SELLER rule >
 * active CATEGORY rule > active DEFAULT rule. No rule means zero fee and a
 * warning; it is never guessed.
 */
export function resolveCommissionRule(
  rules: readonly CommissionRuleLike[],
  params: { sellerId: string; categoryId?: string | null; now?: Date },
): ResolvedCommissionRule {
  const now = params.now ?? new Date();
  const isEffective = (rule: CommissionRuleLike) => {
    const from = rule.effectiveFrom ? new Date(rule.effectiveFrom) : null;
    const to = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
    if (rule.isActive === false) return false;
    if (from && Number.isFinite(from.getTime()) && from > now) return false;
    if (to && Number.isFinite(to.getTime()) && to <= now) return false;
    return true;
  };

  const candidates = rules.filter(isEffective);
  const sellerRule = candidates.find(
    (r) => r.scope === "SELLER" && r.sellerId === params.sellerId,
  );
  const categoryRule = params.categoryId
    ? candidates.find((r) => r.scope === "CATEGORY" && r.categoryId === params.categoryId)
    : undefined;
  const defaultRule = candidates.find((r) => r.scope === "DEFAULT");
  const chosen = sellerRule ?? categoryRule ?? defaultRule;

  if (!chosen) {
    return { id: null, scope: "NONE", type: "NONE", percentageBps: 0, fixedAmountCents: 0 };
  }
  if (chosen.type === "FIXED") {
    return {
      id: chosen.id,
      scope: chosen.scope,
      type: "FIXED",
      percentageBps: 0,
      fixedAmountCents: Math.max(0, chosen.fixedAmountCents ?? 0),
    };
  }
  return {
    id: chosen.id,
    scope: chosen.scope,
    type: "PERCENTAGE",
    percentageBps: Math.max(0, Math.min(10_000, chosen.percentageBps ?? 0)),
    fixedAmountCents: 0,
  };
}

/** Exact integer-cents profit calculation. Inputs are validated, never coerced. */
export function calculateDropshippingPricing(input: PricingInput): PricingBreakdown {
  if (input.currency.toUpperCase() !== "KES") {
    throw new PricingError(
      "Only KES supplier costs can be estimated; an approved FX rate is required for other currencies.",
      "unsupported_currency",
    );
  }

  const retail = money(input.retailPriceCents, "Retail price", false);
  const supplierCost = money(input.supplierCostMinor, "Supplier cost");
  const delivery = money(input.supplierDeliveryChargeMinor ?? 0, "Supplier delivery charge");
  const fulfilment = money(input.sellerFulfilmentCostCents, "Seller fulfilment cost");
  const commissionFixed = money(input.commission.fixedAmountCents, "Platform fee");
  const paymentRate = rate(input.paymentFeeBps, "Payment fee");
  const taxRate = rate(input.taxBps, "Tax");

  const platformFee =
    input.commission.type === "FIXED"
      ? commissionFixed
      : (retail * rate(input.commission.percentageBps, "Platform fee") + 5_000n) / 10_000n;
  const paymentFee = (retail * paymentRate + 5_000n) / 10_000n;
  const tax = (retail * taxRate + 5_000n) / 10_000n;
  const estimatedCost = supplierCost + delivery + fulfilment + platformFee + paymentFee + tax;
  const grossProfit = retail - estimatedCost;
  const marginBps = Number((grossProfit * 10_000n) / retail);

  const warnings = new Set<string>(input.configWarnings ?? []);
  if (!input.costVerified) warnings.add("supplier_cost_unverified");
  if (!input.deliveryChargeVerified) warnings.add("supplier_delivery_charge_unverified");
  if (!input.feeConfigVerified) warnings.add("fee_config_unverified");
  if (input.commission.scope === "NONE") warnings.add("platform_fee_unconfigured");
  if (grossProfit < 0n) warnings.add("negative_estimated_profit");

  // An estimate stays an estimate until the supplier cost, delivery charge and
  // the business-approved fee configuration are all verified.
  const isEstimate = !(
    input.costVerified &&
    input.deliveryChargeVerified &&
    input.feeConfigVerified &&
    input.commission.scope !== "NONE"
  );

  const asNumber = (value: bigint, label: string): number => {
    // Costs can legitimately exceed a single price ceiling before validation,
    // but a snapshot that large cannot be stored in an INTEGER column.
    if (value > 2_147_483_647n || value < -2_147_483_647n) {
      throw new PricingError(`${label} exceeds the supported money range.`, "invalid_money");
    }
    return Number(value);
  };

  return {
    currency: "KES",
    retailPriceCents: Number(retail),
    supplierCostCents: Number(supplierCost),
    supplierDeliveryCents: Number(delivery),
    sellerFulfilmentCents: Number(fulfilment),
    platformFeeCents: asNumber(platformFee, "Platform fee"),
    paymentFeeCents: asNumber(paymentFee, "Payment fee"),
    taxCents: asNumber(tax, "Tax"),
    estimatedCostCents: asNumber(estimatedCost, "Estimated cost"),
    estimatedGrossProfitCents: asNumber(grossProfit, "Estimated gross profit"),
    marginBps,
    commissionRuleId: input.commission.id,
    commissionScope: input.commission.scope,
    isEstimate,
    configVersion: input.configVersion,
    warnings: [...warnings],
  };
}
