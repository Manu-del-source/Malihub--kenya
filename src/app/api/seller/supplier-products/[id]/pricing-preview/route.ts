import { NextResponse, type NextRequest } from "next/server";
import { pricingPreviewSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  logSafeError,
  requireActiveActor,
  requireVerifiedSeller,
} from "@/lib/dropshipping/http";
import { computeSupplierPricing } from "@/services/dropshipping-pricing-service";
import { PricingError } from "@/lib/dropshipping/pricing";

/**
 * Server-side profit preview for a VERIFIED seller.
 *
 * The existing catalog API stays cost-free. This endpoint returns derived KES
 * profit/margin and fee amounts only — never the raw supplier cost, delivery
 * charge, supplier contact details or internal notes. A buyer, an unverified
 * seller, or a cross-origin site using a seller's cookies gets no numbers.
 *
 * Every result is explicitly labelled as an estimate unless the supplier cost,
 * delivery charge and fee configuration have all been verified.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireActiveActor();
  if (!guard.ok) return guard.response;
  const seller = await requireVerifiedSeller(prisma, guard.actor);
  if (seller instanceof NextResponse) return seller;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier product id." }, { status: 400 });
  }
  const parsed = pricingPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid price or fulfilment cost.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const category = parsed.data.categorySlug
      ? await prisma.category.findUnique({
          where: { slug: parsed.data.categorySlug },
          select: { id: true },
        })
      : null;
    const result = await computeSupplierPricing(prisma, {
      supplierProductId: id,
      sellerId: seller.id,
      categoryId: category?.id ?? null,
      retailPriceCents: parsed.data.priceCents,
      sellerFulfilmentCostCents: parsed.data.sellerFulfilmentCostCents,
    });
    const b = result.breakdown;
    return NextResponse.json({
      success: true,
      data: {
        currency: b.currency,
        retailPriceCents: b.retailPriceCents,
        estimatedCostCents: b.estimatedCostCents,
        estimatedGrossProfitCents: b.estimatedGrossProfitCents,
        marginBps: b.marginBps,
        isEstimate: b.isEstimate,
        configVersion: b.configVersion,
        warnings: b.warnings,
        fees: {
          platformFeeCents: b.platformFeeCents,
          paymentFeeCents: b.paymentFeeCents,
          taxCents: b.taxCents,
          sellerFulfilmentCents: b.sellerFulfilmentCents,
        },
        commissionScope: b.commissionScope,
      },
    });
  } catch (error) {
    if (error instanceof PricingError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof Error && error.message === "supplier_product_unavailable") {
      return NextResponse.json(
        { success: false, error: "This approved supplier product is not available for pricing." },
        { status: 404 },
      );
    }
    logSafeError("POST /api/seller/supplier-products/[id]/pricing-preview failed", error);
    return NextResponse.json({ success: false, error: "Unable to calculate pricing." }, { status: 500 });
  }
}
