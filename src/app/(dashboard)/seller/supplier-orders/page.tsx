import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import {
  SupplierFulfilmentBoard,
  type SupplierFulfilmentBoardItem,
} from "@/components/shell/seller/supplier-fulfilment-board";
import { requireSellerAccess } from "@/lib/auth";
import { BUYER_DASHBOARD_PATH } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { SELLER_FULFILMENT_SELECT } from "@/lib/dropshipping/selects";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supplier orders — MaliHub" };

/** Seller operations queue for supplier-fulfilled order lines. */
export default async function SellerSupplierOrdersPage() {
  const { user } = await requireSellerAccess();
  const seller = await prisma.seller.findUnique({
    where: { userId: user.id },
    select: { id: true, businessName: true, verificationStatus: true },
  });
  if (!seller) redirect(BUYER_DASHBOARD_PATH);

  const rows = await prisma.supplierFulfilment.findMany({
    where: { sellerId: seller.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: SELLER_FULFILMENT_SELECT,
  });

  const items = rows.map((row) => ({
    ...row,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    expectedDispatchAt: row.expectedDispatchAt?.toISOString() ?? null,
    lastStatusChangedAt: row.lastStatusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    supplierProduct: {
      ...row.supplierProduct,
      stockVerifiedAt: row.supplierProduct.stockVerifiedAt?.toISOString() ?? null,
    },
    order: row.order,
    product: row.product,
    purchase: row.purchase
      ? {
          ...row.purchase,
          confirmedAt: row.purchase.confirmedAt?.toISOString() ?? null,
          paidAt: row.purchase.paidAt?.toISOString() ?? null,
          reconciledAt: row.purchase.reconciledAt?.toISOString() ?? null,
        }
      : null,
    returnRequest: row.returnRequest
      ? { ...row.returnRequest, requestedAt: row.returnRequest.requestedAt.toISOString() }
      : null,
  })) as unknown as SupplierFulfilmentBoardItem[];

  return (
    <Container className="min-h-[calc(100svh-180px)] py-10 text-foreground sm:py-12">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Dropshipping operations
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium">Supplier orders</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Confirm availability and final supplier cost, record the manual purchase, and add courier
          tracking. Supplier stock here is a last-known snapshot, not a live reservation.
        </p>
      </div>
      <SupplierFulfilmentBoard initialItems={items} />
    </Container>
  );
}
