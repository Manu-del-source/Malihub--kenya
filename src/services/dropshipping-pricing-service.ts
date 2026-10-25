import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  calculateDropshippingPricing,
  resolveCommissionRule,
  type CommissionRuleLike,
  type PricingBreakdown,
  type ResolvedCommissionRule,
} from "@/lib/dropshipping/pricing";
import { readDropshippingConfig, type DropshippingConfig } from "@/lib/dropshipping/config";
import { logAuditEvent } from "@/services/audit-service";

export type PricingStore = Pick<
  PrismaClient,
  "supplierProduct" | "commissionRule" | "supplierListingCost"
>;

type SupplierCostRow = {
  id: string;
  costMinor: number;
  currency: string;
  deliveryChargeMinor: number | null;
  costStatus: string;
  deliveryChargeVerifiedAt: Date | null;
  supplier: { status: string };
};

export type PricingComputation = {
  breakdown: PricingBreakdown;
  commission: ResolvedCommissionRule;
  config: DropshippingConfig;
  supplierCost: SupplierCostRow;
};

async function loadCommission(
  db: Pick<PrismaClient, "commissionRule">,
  sellerId: string,
  categoryId?: string | null,
): Promise<ResolvedCommissionRule> {
  const rules = await db.commissionRule.findMany({
    where: { isActive: true },
    select: {
      id: true,
      scope: true,
      sellerId: true,
      categoryId: true,
      type: true,
      percentageBps: true,
      fixedAmountCents: true,
      isActive: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });
  return resolveCommissionRule(rules as CommissionRuleLike[], { sellerId, categoryId });
}

/**
 * Computes a KES estimate from server-side data only. The caller supplies the
 * retail price and the seller's own fulfilment cost; supplier cost, delivery
 * charge, commission and fee config are read from the database/environment.
 */
export async function computeSupplierPricing(
  db: PricingStore,
  params: {
    supplierProductId: string;
    sellerId: string;
    categoryId?: string | null;
    retailPriceCents: number;
    sellerFulfilmentCostCents?: number;
    now?: Date;
  },
): Promise<PricingComputation> {
  const supplierProduct = (await db.supplierProduct.findFirst({
    where: {
      id: params.supplierProductId,
      isActive: true,
      approvalStatus: "APPROVED",
      supplier: { status: "APPROVED" },
    },
    select: {
      id: true,
      costMinor: true,
      currency: true,
      deliveryChargeMinor: true,
      costStatus: true,
      deliveryChargeVerifiedAt: true,
      supplier: { select: { status: true } },
    },
  })) as SupplierCostRow | null;
  if (!supplierProduct) throw new Error("supplier_product_unavailable");

  const config = readDropshippingConfig();
  const commission = await loadCommission(db, params.sellerId, params.categoryId);
  const breakdown = calculateDropshippingPricing({
    retailPriceCents: params.retailPriceCents,
    supplierCostMinor: supplierProduct.costMinor,
    supplierDeliveryChargeMinor: supplierProduct.deliveryChargeMinor,
    sellerFulfilmentCostCents: params.sellerFulfilmentCostCents ?? 0,
    commission,
    paymentFeeBps: config.paymentFeeBps,
    taxBps: config.taxBps,
    currency: supplierProduct.currency,
    costVerified: supplierProduct.costStatus === "CONFIRMED",
    deliveryChargeVerified: supplierProduct.deliveryChargeVerifiedAt !== null,
    feeConfigVerified: config.feeConfigVerified,
    configVersion: config.configVersion,
    configWarnings: config.warnings,
  });
  return { breakdown, commission, config, supplierCost: supplierProduct };
}

/** Writes (or refreshes) the private per-listing snapshot for a seller draft. */
export async function storeSupplierListingCost(
  db: PricingStore,
  params: {
    productId: string;
    supplierProductId: string;
    sellerId: string;
    categoryId: string;
    retailPriceCents: number;
    sellerFulfilmentCostCents?: number;
  },
): Promise<PricingBreakdown> {
  const computation = await computeSupplierPricing(db, {
    supplierProductId: params.supplierProductId,
    sellerId: params.sellerId,
    categoryId: params.categoryId,
    retailPriceCents: params.retailPriceCents,
    sellerFulfilmentCostCents: params.sellerFulfilmentCostCents,
  });
  const b = computation.breakdown;
  await db.supplierListingCost.upsert({
    where: { productId: params.productId },
    create: {
      productId: params.productId,
      supplierProductId: params.supplierProductId,
      sellerId: params.sellerId,
      retailPriceCents: b.retailPriceCents,
      supplierCostMinor: b.supplierCostCents,
      supplierDeliveryChargeMinor: b.supplierDeliveryCents,
      sellerFulfilmentCostCents: b.sellerFulfilmentCents,
      platformFeeCents: b.platformFeeCents,
      paymentFeeCents: b.paymentFeeCents,
      taxCents: b.taxCents,
      estimatedCostCents: b.estimatedCostCents,
      estimatedProfitCents: b.estimatedGrossProfitCents,
      marginBps: b.marginBps,
      currency: b.currency,
      isEstimate: b.isEstimate,
      configVersion: b.configVersion,
      warnings: b.warnings,
      calculatedAt: new Date(),
    },
    update: {
      retailPriceCents: b.retailPriceCents,
      supplierCostMinor: b.supplierCostCents,
      supplierDeliveryChargeMinor: b.supplierDeliveryCents,
      sellerFulfilmentCostCents: b.sellerFulfilmentCents,
      platformFeeCents: b.platformFeeCents,
      paymentFeeCents: b.paymentFeeCents,
      taxCents: b.taxCents,
      estimatedCostCents: b.estimatedCostCents,
      estimatedProfitCents: b.estimatedGrossProfitCents,
      marginBps: b.marginBps,
      isEstimate: b.isEstimate,
      configVersion: b.configVersion,
      warnings: b.warnings,
      calculatedAt: new Date(),
    },
  });
  return b;
}

/**
 * Recomputes cost snapshots after a verified supplier cost/delivery change.
 * It NEVER changes `Product.priceCents` and NEVER publishes a draft; sellers
 * must decide whether to reprice. Returns the number of listings refreshed.
 */
export async function recalculateSupplierListingCosts(
  db: PricingStore,
  supplierProductId: string,
  actor?: { id: string; email?: string | null },
): Promise<number> {
  const [supplierProduct, listingCosts] = await Promise.all([
    db.supplierProduct.findUnique({
      where: { id: supplierProductId },
      select: {
        id: true,
        costMinor: true,
        currency: true,
        deliveryChargeMinor: true,
        costStatus: true,
        deliveryChargeVerifiedAt: true,
      },
    }),
    db.supplierListingCost.findMany({
      where: { supplierProductId },
      select: {
        productId: true,
        sellerId: true,
        retailPriceCents: true,
        sellerFulfilmentCostCents: true,
      },
    }),
  ]);
  if (!supplierProduct || listingCosts.length === 0) return 0;

  const config = readDropshippingConfig();
  let updated = 0;
  for (const listing of listingCosts) {
    const commission = await loadCommission(db, listing.sellerId);
    const breakdown = calculateDropshippingPricing({
      retailPriceCents: listing.retailPriceCents,
      supplierCostMinor: supplierProduct.costMinor,
      supplierDeliveryChargeMinor: supplierProduct.deliveryChargeMinor,
      sellerFulfilmentCostCents: listing.sellerFulfilmentCostCents,
      commission,
      paymentFeeBps: config.paymentFeeBps,
      taxBps: config.taxBps,
      currency: supplierProduct.currency,
      costVerified: supplierProduct.costStatus === "CONFIRMED",
      deliveryChargeVerified: supplierProduct.deliveryChargeVerifiedAt !== null,
      feeConfigVerified: config.feeConfigVerified,
      configVersion: config.configVersion,
      configWarnings: config.warnings,
    });
    await db.supplierListingCost.update({
      where: { productId: listing.productId },
      data: {
        supplierCostMinor: breakdown.supplierCostCents,
        supplierDeliveryChargeMinor: breakdown.supplierDeliveryCents,
        platformFeeCents: breakdown.platformFeeCents,
        paymentFeeCents: breakdown.paymentFeeCents,
        taxCents: breakdown.taxCents,
        estimatedCostCents: breakdown.estimatedCostCents,
        estimatedProfitCents: breakdown.estimatedGrossProfitCents,
        marginBps: breakdown.marginBps,
        isEstimate: breakdown.isEstimate,
        configVersion: breakdown.configVersion,
        warnings: breakdown.warnings,
        calculatedAt: new Date(),
      },
    });
    updated += 1;
  }

  await logAuditEvent({
    action: "supplier_listing_cost.recalculated",
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    targetType: "supplier_product",
    targetId: supplierProductId,
    metadata: { listingCount: updated, configVersion: config.configVersion },
  }).catch(() => undefined);
  return updated;
}
