import type { PrismaClient } from "@prisma/client";
import {
  buildRevenueReport,
  type CommissionRuleInput,
  type OrderStatusName,
  type RevenueOrderInput,
  type RevenueReport,
} from "@/lib/revenue/calculate";

/**
 * Read-only revenue reporting.
 *
 * This service performs NO writes: no payment, refund, settlement, payout or
 * commission-rule changes. Callers must already have passed the administrator
 * guard (`requireAdministrator()` in the page); the service itself never
 * trusts a client-supplied total — everything is rebuilt from order items,
 * SUCCESS payments, COMPLETED refunds and configured commission rules.
 *
 * Date basis: a sale belongs to the period in which its payment succeeded
 * (`Payment.paidAt`). Commission earned/pending then depends on the order's
 * CURRENT status, so the report answers "of the orders paid in this period,
 * how much has MaliHub earned, and how much is still pending?".
 */

export const MAX_REPORT_PAYMENTS = 5000;

export type RevenueDb = Pick<PrismaClient, "payment" | "commissionRule">;

export type RevenueServiceResult = {
  report: RevenueReport;
  /** True when more payments matched than MAX_REPORT_PAYMENTS; totals are then incomplete. */
  truncated: boolean;
  generatedAt: Date;
};

export async function getRevenueReport(
  db: RevenueDb,
  range: { from: Date; to: Date },
  now: Date = new Date()
): Promise<RevenueServiceResult> {
  const [payments, ruleRows] = await Promise.all([
    db.payment.findMany({
      where: { status: "SUCCESS", paidAt: { gte: range.from, lt: range.to } },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      take: MAX_REPORT_PAYMENTS + 1,
      select: {
        orderId: true,
        provider: true,
        providerTransactionId: true,
        paidAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            sellerId: true,
            status: true,
            deliveryFeeCents: true,
            seller: { select: { businessName: true } },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPriceCents: true,
                product: { select: { categoryId: true } },
              },
            },
            refunds: { where: { status: "COMPLETED" }, select: { amountCents: true } },
            settlement: { select: { providerFeeCents: true } },
          },
        },
      },
    }),
    db.commissionRule.findMany({ where: { isActive: true } }),
  ]);

  const truncated = payments.length > MAX_REPORT_PAYMENTS;
  const rows = truncated ? payments.slice(0, MAX_REPORT_PAYMENTS) : payments;

  // One authoritative payment per order: the earliest SUCCESS payment. Extra
  // SUCCESS rows for the same order are reported as a warning, never summed.
  const firstByOrder = new Map<string, (typeof rows)[number]>();
  const duplicateOrderIds = new Set<string>();
  for (const p of rows) {
    if (!p.paidAt) continue;
    if (firstByOrder.has(p.orderId)) duplicateOrderIds.add(p.orderId);
    else firstByOrder.set(p.orderId, p);
  }

  const orders: RevenueOrderInput[] = [...firstByOrder.values()].map((p) => ({
    orderId: p.order.id,
    orderNumber: p.order.orderNumber,
    sellerId: p.order.sellerId,
    sellerName: p.order.seller.businessName,
    status: p.order.status as OrderStatusName,
    paidAt: p.paidAt as Date,
    provider: p.provider,
    providerTransactionId: p.providerTransactionId,
    items: p.order.items.map((i) => ({
      id: i.id,
      categoryId: i.product.categoryId,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
    })),
    deliveryFeeCents: p.order.deliveryFeeCents,
    completedRefundCents: p.order.refunds.reduce((t, r) => t + r.amountCents, 0),
    // Only a recorded settlement carries a real provider fee. Zero on a PENDING
    // settlement means "not yet known", so it is treated as no data.
    providerFeeCents:
      p.order.settlement && p.order.settlement.providerFeeCents > 0 ? p.order.settlement.providerFeeCents : null,
  }));

  const rules: CommissionRuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    scope: r.scope,
    sellerId: r.sellerId,
    categoryId: r.categoryId,
    type: r.type,
    percentageBps: r.percentageBps,
    fixedAmountCents: r.fixedAmountCents,
    isActive: r.isActive,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));

  return {
    report: buildRevenueReport(orders, rules, { duplicatePaymentOrderIds: [...duplicateOrderIds] }),
    truncated,
    generatedAt: now,
  };
}
