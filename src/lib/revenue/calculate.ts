/**
 * Marketplace revenue calculation — pure, integer-cent arithmetic only.
 *
 * Mirrors `backend/app/services/commission_service.py` exactly:
 *   - precedence SELLER > CATEGORY > DEFAULT, latest `effectiveFrom` wins
 *   - a rule is effective at `at` when active, at >= effectiveFrom and
 *     (effectiveTo is null or at < effectiveTo)
 *   - PERCENTAGE = (gross * bps + 5_000) / 10_000, half-up, integer
 *   - FIXED is clamped to the gross it applies to
 *   - NO matching rule is a configuration gap, never a silent 0%.
 *
 * Nothing here reads the database or touches payments, refunds, settlements
 * or payouts. It only reports on rows handed to it.
 *
 * Definitions (see docs/admin-revenue-dashboard.md):
 *   merchandise   = Σ unitPriceCents × quantity   (delivery is never included)
 *   commission    = rule applied to merchandise
 *   seller share  = merchandise − commission
 *   pending       = paid orders not yet COMPLETED (PAID/SHIPPED/DELIVERED)
 *   earned        = commission on COMPLETED orders
 *   net platform revenue = earned − commission reversals on those orders
 */

export type OrderStatusName =
  | "PENDING" | "CONFIRMED" | "PAID" | "SHIPPED" | "DELIVERED" | "COMPLETED" | "CANCELLED" | "REFUNDED";

export type CommissionRuleInput = {
  id: string;
  scope: "DEFAULT" | "SELLER" | "CATEGORY";
  sellerId: string | null;
  categoryId: string | null;
  type: "PERCENTAGE" | "FIXED";
  percentageBps: number | null;
  fixedAmountCents: number | null;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type RevenueOrderInput = {
  orderId: string;
  orderNumber: string;
  sellerId: string;
  sellerName: string;
  status: OrderStatusName;
  /** `paidAt` of the single authoritative SUCCESS payment. */
  paidAt: Date;
  provider: string;
  providerTransactionId: string | null;
  items: Array<{ id: string; categoryId: string; unitPriceCents: number; quantity: number }>;
  deliveryFeeCents: number;
  /** Σ Refund.amountCents where Refund.status = COMPLETED (money actually returned). */
  completedRefundCents: number;
  /** Actual provider fee when recorded (Settlement.providerFeeCents); null = unknown. */
  providerFeeCents: number | null;
};

export type OrderRevenueLine = {
  orderId: string;
  orderNumber: string;
  sellerId: string;
  sellerName: string;
  status: OrderStatusName;
  bucket: "earned" | "pending" | "refunded";
  provider: string;
  providerTransactionId: string | null;
  paidAt: Date;
  merchandiseCents: number;
  deliveryFeeCents: number;
  commissionConfigured: boolean;
  commissionCents: number;
  appliedRules: Array<{ ruleId: string; scope: string; description: string; merchandiseCents: number; commissionCents: number }>;
  sellerShareCents: number;
  refundedMerchandiseCents: number;
  commissionReversalCents: number;
  netCommissionCents: number;
  netSellerShareCents: number;
  refundCashCents: number;
  providerFeeCents: number | null;
};

export type RevenueBreakdownRow = {
  key: string;
  label: string;
  orders: number;
  merchandiseCents: number;
  netCommissionCents: number;
  netSellerShareCents: number;
};

export type RevenueSummary = {
  grossMerchandiseSalesCents: number;
  completedMerchandiseSalesCents: number;
  commissionEarnedCents: number;
  commissionReversalsOnEarnedCents: number;
  pendingCommissionCents: number;
  sellerEarningsPayableCents: number;
  sellerEarningsPendingCents: number;
  refundsCents: number;
  commissionReversalsCents: number;
  netPlatformRevenueCents: number;
  paymentProcessingFeesCents: number;
  ordersWithProviderFeeData: number;
  ordersWithoutProviderFeeData: number;
  deliveryChargesCents: number;
  totalOrders: number;
  averageOrderValueCents: number | null;
};

export type RevenueReport = {
  summary: RevenueSummary;
  lines: OrderRevenueLine[];
  bySeller: RevenueBreakdownRow[];
  byProvider: RevenueBreakdownRow[];
  byStatus: RevenueBreakdownRow[];
  warnings: {
    /** Orders whose commission could not be calculated because no rule applied. */
    unconfiguredCommissionOrderIds: string[];
    /** Orders that had more than one SUCCESS payment row (only one was counted). */
    duplicatePaymentOrderIds: string[];
    hasDefaultRule: boolean;
  };
};

const COUNTED_STATUSES: readonly OrderStatusName[] = ["PAID", "SHIPPED", "DELIVERED", "COMPLETED", "REFUNDED"];

export function isCountedSaleStatus(status: OrderStatusName): boolean {
  return COUNTED_STATUSES.includes(status);
}

/** Integer half-up division for non-negative operands. */
export function divHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError("denominator must be positive");
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents`);
  }
}

export function isRuleEffectiveAt(rule: CommissionRuleInput, at: Date): boolean {
  if (!rule.isActive) return false;
  if (at < rule.effectiveFrom) return false;
  return rule.effectiveTo === null || at < rule.effectiveTo;
}

function latest(rules: CommissionRuleInput[]): CommissionRuleInput {
  return rules.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));
}

/** Same precedence as CommissionService._resolve_rule. Returns null when nothing applies. */
export function resolveCommissionRule(
  rules: readonly CommissionRuleInput[],
  sellerId: string,
  categoryId: string | null,
  at: Date
): CommissionRuleInput | null {
  const effective = rules.filter((r) => isRuleEffectiveAt(r, at));
  const seller = effective.filter((r) => r.scope === "SELLER" && r.sellerId === sellerId);
  if (seller.length) return latest(seller);
  if (categoryId !== null) {
    const category = effective.filter((r) => r.scope === "CATEGORY" && r.categoryId === categoryId);
    if (category.length) return latest(category);
  }
  const def = effective.filter((r) => r.scope === "DEFAULT");
  return def.length ? latest(def) : null;
}

function applyRule(rule: CommissionRuleInput, merchandiseCents: number): number {
  if (rule.type === "FIXED") {
    if (rule.fixedAmountCents === null) throw new RangeError(`rule ${rule.id} is FIXED without fixedAmountCents`);
    return Math.min(rule.fixedAmountCents, merchandiseCents);
  }
  if (rule.percentageBps === null) throw new RangeError(`rule ${rule.id} is PERCENTAGE without percentageBps`);
  return Math.min(divHalfUp(merchandiseCents * rule.percentageBps, 10_000), merchandiseCents);
}

function describeRule(rule: CommissionRuleInput): string {
  return rule.type === "FIXED"
    ? `Fixed ${rule.fixedAmountCents} cents`
    : `${((rule.percentageBps ?? 0) / 100).toFixed(2)}%`;
}

export function calculateOrderRevenue(
  order: RevenueOrderInput,
  rules: readonly CommissionRuleInput[]
): OrderRevenueLine {
  assertCents(order.deliveryFeeCents, "deliveryFeeCents");
  assertCents(order.completedRefundCents, "completedRefundCents");

  let merchandise = 0;
  const groups = new Map<string, { rule: CommissionRuleInput; merchandise: number }>();
  let unconfigured = false;
  for (const item of order.items) {
    assertCents(item.unitPriceCents, "unitPriceCents");
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new RangeError("quantity must be a positive integer");
    const line = item.unitPriceCents * item.quantity;
    merchandise += line;
    const rule = resolveCommissionRule(rules, order.sellerId, item.categoryId, order.paidAt);
    if (!rule) {
      unconfigured = true;
      continue;
    }
    const g = groups.get(rule.id) ?? { rule, merchandise: 0 };
    g.merchandise += line;
    groups.set(rule.id, g);
  }

  const appliedRules: OrderRevenueLine["appliedRules"] = [];
  let commission = 0;
  if (!unconfigured) {
    for (const { rule, merchandise: groupMerch } of groups.values()) {
      const c = applyRule(rule, groupMerch);
      commission += c;
      appliedRules.push({ ruleId: rule.id, scope: rule.scope, description: describeRule(rule), merchandiseCents: groupMerch, commissionCents: c });
    }
    commission = Math.min(commission, merchandise);
  }

  const sellerShare = unconfigured ? 0 : merchandise - commission;

  // Refund handling: refunds are applied to merchandise first, capped at it. The
  // Refund record does not say how much of the money was delivery, so this is the
  // conservative reading (it never overstates retained revenue).
  const fullyRefunded = order.status === "REFUNDED";
  const refundedMerch = fullyRefunded ? merchandise : Math.min(order.completedRefundCents, merchandise);
  const reversal =
    unconfigured || merchandise === 0
      ? 0
      : refundedMerch >= merchandise
        ? commission
        : divHalfUp(commission * refundedMerch, merchandise);

  const bucket: OrderRevenueLine["bucket"] =
    fullyRefunded ? "refunded" : order.status === "COMPLETED" ? "earned" : "pending";

  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    sellerId: order.sellerId,
    sellerName: order.sellerName,
    status: order.status,
    bucket,
    provider: order.provider,
    providerTransactionId: order.providerTransactionId,
    paidAt: order.paidAt,
    merchandiseCents: merchandise,
    deliveryFeeCents: order.deliveryFeeCents,
    commissionConfigured: !unconfigured,
    commissionCents: commission,
    appliedRules,
    sellerShareCents: sellerShare,
    refundedMerchandiseCents: refundedMerch,
    commissionReversalCents: reversal,
    netCommissionCents: commission - reversal,
    netSellerShareCents: unconfigured ? 0 : merchandise - refundedMerch - (commission - reversal),
    refundCashCents: fullyRefunded ? Math.max(order.completedRefundCents, 0) : order.completedRefundCents,
    providerFeeCents: order.providerFeeCents,
  };
}

function breakdown(
  lines: OrderRevenueLine[],
  keyOf: (l: OrderRevenueLine) => { key: string; label: string }
): RevenueBreakdownRow[] {
  const map = new Map<string, RevenueBreakdownRow>();
  for (const l of lines) {
    const { key, label } = keyOf(l);
    const row = map.get(key) ?? { key, label, orders: 0, merchandiseCents: 0, netCommissionCents: 0, netSellerShareCents: 0 };
    row.orders += 1;
    row.merchandiseCents += l.merchandiseCents;
    row.netCommissionCents += l.netCommissionCents;
    row.netSellerShareCents += l.netSellerShareCents;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.merchandiseCents - a.merchandiseCents || a.label.localeCompare(b.label));
}

/**
 * Builds the report from already-fetched rows.
 *
 * Duplicate protection: callers pass one row per order. Orders that appear
 * more than once (same orderId) are counted once — the first occurrence wins —
 * and a second SUCCESS payment for the same provider transaction id is never
 * counted as another sale.
 */
export function buildRevenueReport(
  orders: readonly RevenueOrderInput[],
  rules: readonly CommissionRuleInput[],
  options: { duplicatePaymentOrderIds?: string[] } = {}
): RevenueReport {
  const seenOrders = new Set<string>();
  const seenTransactions = new Set<string>();
  const lines: OrderRevenueLine[] = [];

  for (const order of orders) {
    if (!isCountedSaleStatus(order.status)) continue; // unpaid / cancelled are not sales
    if (seenOrders.has(order.orderId)) continue;
    if (order.providerTransactionId) {
      if (seenTransactions.has(order.providerTransactionId)) continue;
      seenTransactions.add(order.providerTransactionId);
    }
    seenOrders.add(order.orderId);
    lines.push(calculateOrderRevenue(order, rules));
  }

  const s: RevenueSummary = {
    grossMerchandiseSalesCents: 0,
    completedMerchandiseSalesCents: 0,
    commissionEarnedCents: 0,
    commissionReversalsOnEarnedCents: 0,
    pendingCommissionCents: 0,
    sellerEarningsPayableCents: 0,
    sellerEarningsPendingCents: 0,
    refundsCents: 0,
    commissionReversalsCents: 0,
    netPlatformRevenueCents: 0,
    paymentProcessingFeesCents: 0,
    ordersWithProviderFeeData: 0,
    ordersWithoutProviderFeeData: 0,
    deliveryChargesCents: 0,
    totalOrders: lines.length,
    averageOrderValueCents: null,
  };

  for (const l of lines) {
    s.grossMerchandiseSalesCents += l.merchandiseCents;
    s.deliveryChargesCents += l.deliveryFeeCents;
    s.refundsCents += l.refundCashCents;
    s.commissionReversalsCents += l.commissionReversalCents;
    if (l.providerFeeCents === null) s.ordersWithoutProviderFeeData += 1;
    else {
      s.ordersWithProviderFeeData += 1;
      s.paymentProcessingFeesCents += l.providerFeeCents;
    }
    if (l.bucket === "earned") {
      s.completedMerchandiseSalesCents += l.merchandiseCents;
      s.commissionEarnedCents += l.commissionCents;
      s.commissionReversalsOnEarnedCents += l.commissionReversalCents;
      s.sellerEarningsPayableCents += l.netSellerShareCents;
    } else if (l.bucket === "pending") {
      s.pendingCommissionCents += l.netCommissionCents;
      s.sellerEarningsPendingCents += l.netSellerShareCents;
    }
  }
  s.netPlatformRevenueCents = s.commissionEarnedCents - s.commissionReversalsOnEarnedCents;
  s.averageOrderValueCents = lines.length ? divHalfUp(s.grossMerchandiseSalesCents, lines.length) : null;

  return {
    summary: s,
    lines,
    bySeller: breakdown(lines, (l) => ({ key: l.sellerId, label: l.sellerName })),
    byProvider: breakdown(lines, (l) => ({ key: l.provider, label: l.provider })),
    byStatus: breakdown(lines, (l) => ({ key: l.status, label: l.status })),
    warnings: {
      unconfiguredCommissionOrderIds: lines.filter((l) => !l.commissionConfigured).map((l) => l.orderId),
      duplicatePaymentOrderIds: options.duplicatePaymentOrderIds ?? [],
      hasDefaultRule: rules.some((r) => r.scope === "DEFAULT" && r.isActive),
    },
  };
}
