import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { importSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/utils";
import {
  isPrismaErrorCode,
  logSafeError,
  requireActiveActor,
  requireVerifiedSeller,
} from "@/lib/dropshipping/http";
import { classifySupplierAvailability } from "@/lib/dropshipping/availability";
import { readDropshippingConfig } from "@/lib/dropshipping/config";
import { storeSupplierListingCost } from "@/services/dropshipping-pricing-service";
import { logAuditEvent } from "@/services/audit-service";

/**
 * Imports an APPROVED supplier product as the seller's own unpublished DRAFT.
 *
 * Safety properties:
 *  - session, active account, verified seller and same-origin checks first;
 *  - UUID + Zod validation before any database read;
 *  - supplier AND supplier-product approval are re-checked at write time;
 *  - a stale/unknown stock snapshot is allowed only with an explicit caveat;
 *  - a partial unique index plus P2002 handling makes concurrent imports safe;
 *  - the private cost snapshot is stored in a separate seller-scoped table and
 *    never returned to buyers or other sellers. Nothing is published or paid.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const guard = await requireActiveActor();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const seller = await requireVerifiedSeller(prisma, guard.actor);
    if (seller instanceof NextResponse) return seller;

    const { id: supplierProductId } = await context.params;
    // An invalid id is indistinguishable from a missing one: both are 404 with
    // the same copy, so this route cannot be used to probe supplier products.
    if (!uuidSchema.safeParse(supplierProductId).success) {
      return NextResponse.json(
        { success: false, error: "Supplier product is unavailable or its supplier is not approved." },
        { status: 404 },
      );
    }

    const [source, category, existing] = await Promise.all([
      prisma.supplierProduct.findFirst({
        where: {
          id: supplierProductId,
          isActive: true,
          approvalStatus: "APPROVED",
          supplier: { status: "APPROVED" },
        },
        select: {
          id: true,
          title: true,
          description: true,
          currency: true,
          stockStatus: true,
          availableQuantity: true,
          stockVerifiedAt: true,
          lastSyncedAt: true,
          costStatus: true,
          supplier: { select: { name: true, status: true, deliveryEstimateMaxDays: true } },
        },
      }),
      prisma.category.findUnique({
        where: { slug: parsed.data.categorySlug },
        select: { id: true },
      }),
      prisma.product.findFirst({
        where: { sellerId: seller.id, supplierProductId, status: { not: "REMOVED" } },
        select: { id: true, slug: true },
      }),
    ]);

    if (!source) {
      return NextResponse.json(
        { success: false, error: "Supplier product is unavailable or its supplier is not approved." },
        { status: 404 },
      );
    }
    if (!category) {
      return NextResponse.json({ success: false, error: "Select a valid category." }, { status: 400 });
    }
    if (existing) {
      return NextResponse.json(
        { success: false, error: "You have already imported this supplier product.", data: existing },
        { status: 409 },
      );
    }

    const availability = classifySupplierAvailability({
      supplierStatus: source.supplier.status,
      approvalStatus: "APPROVED",
      isActive: true,
      stockStatus: source.stockStatus,
      availableQuantity: source.availableQuantity,
      stockVerifiedAt: source.stockVerifiedAt,
      lastSyncedAt: source.lastSyncedAt,
      maxAgeHours: readDropshippingConfig().stockMaxAgeHours,
    });
    if (!availability.canImport) {
      return NextResponse.json(
        { success: false, error: "This supplier product is not currently available for import.", availability },
        { status: 409 },
      );
    }

    const product = await prisma.product.create({
      data: {
        ownerId: guard.actor.id,
        sellerId: seller.id,
        categoryId: category.id,
        supplierProductId: source.id,
        title: source.title,
        slug: `${slugify(source.title)}-${randomUUID().slice(0, 8)}`,
        description: source.description?.trim()
          ? `${source.description.trim()}\n\nSourced via MaliHub from ${source.supplier.name}. Verify product details and availability before publishing.`
          : `Supplier-sourced product from ${source.supplier.name}. Verify product details and availability before publishing.`,
        priceCents: parsed.data.priceCents,
        isNegotiable: false,
        condition: "NEW",
        quantity: parsed.data.quantity,
        contactPreference: "ANY",
        county: parsed.data.county,
        subCounty: parsed.data.town,
        status: "DRAFT",
        publishedAt: null,
      },
      select: { id: true, title: true, slug: true, status: true, priceCents: true, createdAt: true },
    });

    // Best effort: a pricing failure must not lose the draft, but the seller
    // is told the estimate could not be produced. No raw cost is returned.
    let pricing: {
      estimatedGrossProfitCents: number;
      marginBps: number;
      isEstimate: boolean;
      warnings: string[];
    } | null = null;
    try {
      const breakdown = await storeSupplierListingCost(prisma, {
        productId: product.id,
        supplierProductId: source.id,
        sellerId: seller.id,
        categoryId: category.id,
        retailPriceCents: parsed.data.priceCents,
        sellerFulfilmentCostCents: parsed.data.sellerFulfilmentCostCents,
      });
      pricing = {
        estimatedGrossProfitCents: breakdown.estimatedGrossProfitCents,
        marginBps: breakdown.marginBps,
        isEstimate: breakdown.isEstimate,
        warnings: breakdown.warnings,
      };
    } catch (error) {
      logSafeError("Supplier listing cost snapshot failed", error);
    }

    await logAuditEvent({
      action: "listing.created",
      actorId: guard.actor.id,
      actorEmail: guard.actor.email,
      targetType: "product",
      targetId: product.id,
      metadata: { status: "DRAFT", supplierProductId: source.id, availability: availability.level },
    }).catch(() => undefined);

    return NextResponse.json(
      {
        success: true,
        data: product,
        pricing,
        availability,
        message:
          "Imported as a draft. Add an approved product image, verify stock with the supplier, and review the estimated margin before publishing.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      return NextResponse.json(
        { success: false, error: "You have already imported this supplier product." },
        { status: 409 },
      );
    }
    logSafeError("POST /api/seller/supplier-products/[id]/import failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to import supplier product." },
      { status: 500 },
    );
  }
}
