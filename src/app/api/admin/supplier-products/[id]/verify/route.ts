import { NextResponse, type NextRequest } from "next/server";
import { stockVerificationSchema, uuidSchema } from "@/lib/validations/dropshipping";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/services/audit-service";
import { recalculateSupplierListingCosts } from "@/services/dropshipping-pricing-service";
import { logSafeError, requireAdminActor } from "@/lib/dropshipping/http";
import { resolveSupplierCatalogAdapter, SupplierAdapterUnavailable } from "@/lib/dropshipping/adapters";

/**
 * Manual stock/price refresh. No supplier API is assumed: an administrator
 * records what was confirmed out-of-band. A machine/feed method is accepted
 * only when a verified adapter is configured (none is shipped today).
 *
 * Writes an append-only verification row, updates the last-known snapshot, and
 * recalculates seller cost snapshots. It does NOT publish, reprice or place a
 * supplier order.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: "Invalid supplier product id." }, { status: 400 });
  }
  const parsed = stockVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid verification", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const v = parsed.data;

  try {
    const product = await prisma.supplierProduct.findUnique({
      where: { id },
      select: { id: true, currency: true, feedAdapterKey: true, supplier: { select: { status: true } } },
    });
    if (!product) return NextResponse.json({ success: false, error: "Supplier product not found." }, { status: 404 });

    if (v.method === "SUPPLIER_API" || v.method === "SUPPLIER_FEED") {
      // A machine method must come from a verified, non-manual adapter. No
      // supplier integration is shipped in this repository, so this fails
      // closed rather than pretending a feed was read.
      try {
        const adapter = resolveSupplierCatalogAdapter(product.feedAdapterKey);
        if (adapter.isManual) {
          throw new SupplierAdapterUnavailable(
            "No verified supplier feed adapter is configured for this product.",
          );
        }
      } catch (error) {
        if (error instanceof SupplierAdapterUnavailable) {
          return NextResponse.json({ success: false, error: error.message }, { status: 501 });
        }
        throw error;
      }
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.supplierProductVerification.create({
        data: {
          supplierProductId: id,
          stockStatus: v.stockStatus,
          availableQuantity: v.availableQuantity,
          costMinor: v.costMinor,
          currency: product.currency,
          deliveryChargeMinor: v.deliveryChargeMinor,
          method: v.method,
          sourceReference: v.sourceReference || null,
          verifiedById: guard.actor.id,
          verifiedAt: now,
          note: v.note,
        },
      });
      await tx.supplierProduct.update({
        where: { id },
        data: {
          availableQuantity: v.availableQuantity,
          costMinor: v.costMinor,
          deliveryChargeMinor: v.deliveryChargeMinor,
          stockStatus: v.stockStatus,
          stockVerifiedAt: now,
          verificationMethod: v.method,
          costStatus: "CONFIRMED",
          costVerifiedAt: now,
          deliveryChargeVerifiedAt: v.deliveryChargeMinor !== null ? now : null,
          manualRefreshRequired: false,
          lastVerificationNote: v.note,
          lastSyncedAt: now,
        },
      });
    });

    await logAuditEvent({
      action: "supplier_product.stock_verified",
      actorId: guard.actor.id,
      actorEmail: guard.actor.email,
      targetType: "supplier_product",
      targetId: id,
      metadata: { method: v.method, stockStatus: v.stockStatus, costChanged: true },
    }).catch(() => undefined);

    // KES-only calculator. Foreign-currency products can still be verified,
    // but no FX rate is invented: their cost snapshots stay unchanged.
    let recalculated = 0;
    let pricingWarning: string | null = null;
    if (product.currency.toUpperCase() === "KES") {
      recalculated = await recalculateSupplierListingCosts(prisma, id, guard.actor);
    } else {
      pricingWarning = "FX rate not configured; seller cost estimates were not recalculated.";
    }

    return NextResponse.json({
      success: true,
      data: {
        verifiedAt: now,
        stockStatus: v.stockStatus,
        availableQuantity: v.availableQuantity,
        isSnapshot: true,
        isGuaranteed: false,
        recalculatedListings: recalculated,
        warning: pricingWarning,
      },
    });
  } catch (error) {
    logSafeError("POST /api/admin/supplier-products/[id]/verify failed", error);
    return NextResponse.json({ success: false, error: "Unable to record verification." }, { status: 500 });
  }
}
