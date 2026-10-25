import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { SupplierFulfilmentBoard, type SupplierFulfilmentBoardItem } from "@/components/shell/seller/supplier-fulfilment-board";
import { SupplierReturnDecisionPanel } from "@/components/shell/admin/supplier-return-decision-panel";
import { requireAdministrator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_FULFILMENT_SELECT } from "@/lib/dropshipping/selects";
import { formatKes } from "@/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dropshipping operations — Admin" };

/**
 * Admin operations overview: approvals, stale products, overdue tasks and
 * unresolved disputes. Everything is read from the database with explicit
 * selects; no mock data and no supplier credentials are displayed.
 */
export default async function AdminDropshippingPage() {
  await requireAdministrator();
  const now = new Date();

  const [
    pendingSuppliers,
    pendingProducts,
    staleProducts,
    overdueTasks,
    failedTasks,
    unresolvedReturns,
    failedPurchases,
    recentProducts,
    recentReturns,
    taskRows,
  ] = await Promise.all([
    prisma.supplier.count({ where: { status: "PENDING" } }),
    prisma.supplierProduct.count({ where: { approvalStatus: "PENDING_REVIEW" } }),
    prisma.supplierProduct.count({ where: { manualRefreshRequired: true, approvalStatus: "APPROVED" } }),
    prisma.supplierFulfilment.count({
      where: {
        expectedDispatchAt: { lt: now },
        status: { in: ["AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED"] },
      },
    }),
    prisma.supplierFulfilment.count({ where: { status: "FAILED" } }),
    prisma.supplierReturnRequest.count({
      where: { status: { in: ["REQUESTED", "APPROVED", "ITEM_RETURNED", "REFUND_PENDING"] } },
    }),
    prisma.supplierPurchase.count({ where: { status: { in: ["FAILED", "CANCELLED"] } } }),
    prisma.supplierProduct.findMany({
      where: { approvalStatus: "PENDING_REVIEW" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, sku: true, costMinor: true, currency: true, createdAt: true, supplier: { select: { name: true } } },
    }),
    prisma.supplierReturnRequest.findMany({
      where: { status: { in: ["REQUESTED", "APPROVED", "ITEM_RETURNED", "REFUND_PENDING"] } },
      orderBy: { requestedAt: "desc" },
      take: 8,
      select: {
        id: true, status: true, reason: true, reasonNote: true, responsibility: true,
        requestedAt: true, refundId: true,
        order: { select: { id: true, orderNumber: true } },
        fulfilment: { select: { reference: true } },
      },
    }),
    prisma.supplierFulfilment.findMany({
      where: {
        OR: [
          { status: "FAILED" },
          { expectedDispatchAt: { lt: now }, status: { in: ["AWAITING_SUPPLIER_CONFIRMATION", "CONFIRMED", "ORDERED"] } },
          { returnRequest: { status: { in: ["REQUESTED", "APPROVED", "ITEM_RETURNED", "REFUND_PENDING"] } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: ADMIN_FULFILMENT_SELECT,
    }),
  ]);

  const tasks = taskRows.map((row) => ({
    ...row,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    expectedDispatchAt: row.expectedDispatchAt?.toISOString() ?? null,
    lastStatusChangedAt: row.lastStatusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    costConfirmedAt: row.costConfirmedAt?.toISOString() ?? null,
    supplierProduct: {
      ...row.supplierProduct,
      stockVerifiedAt: row.supplierProduct.stockVerifiedAt?.toISOString() ?? null,
    },
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

  const stats = [
    { label: "Suppliers awaiting approval", value: pendingSuppliers },
    { label: "Products awaiting review", value: pendingProducts },
    { label: "Approved products needing refresh", value: staleProducts },
    { label: "Overdue supplier tasks", value: overdueTasks },
    { label: "Failed tasks", value: failedTasks },
    { label: "Unresolved returns/disputes", value: unresolvedReturns },
    { label: "Failed/cancelled purchases", value: failedPurchases },
  ];

  return (
    <Container className="py-10 text-white">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Admin operations</p>
        <h1 className="mt-2 font-display text-3xl font-medium">Dropshipping control centre</h1>
        <p className="mt-1 text-sm text-white/60">
          Approve suppliers and products, refresh stock/cost snapshots, and resolve fulfilment or
          dispute exceptions. No supplier credential, secret or live feed is stored here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-white/10 bg-[#151515] p-4">
            <p className="font-mono text-2xl text-[#FF8C42]">{stat.value}</p>
            <p className="mt-1 text-[11px] text-white/60">{stat.label}</p>
          </div>
        ))}
      </div>

      <section className="mt-10 rounded-2xl border border-white/10 bg-[#151515] p-5">
        <h2 className="font-display text-xl font-medium">Products awaiting review</h2>
        {recentProducts.length === 0 ? (
          <p className="mt-3 text-sm text-white/60">No products are waiting for review.</p>
        ) : (
          <div className="mt-4 divide-y divide-white/5">
            {recentProducts.map((product) => (
              <div key={product.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">{product.title}</p>
                  <p className="text-xs text-white/50">
                    {product.supplier.name} · {product.sku ?? "no SKU"} · cost {formatKes(product.costMinor)} {product.currency}
                  </p>
                </div>
                <Badge className="bg-amber-500/15 text-amber-200">PENDING_REVIEW</Badge>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-white/50">
          Use the admin supplier product API to record manual stock/cost verification before approval.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-white/10 bg-[#151515] p-5">
        <h2 className="font-display text-xl font-medium">Unresolved returns and disputes</h2>
        {recentReturns.length === 0 ? (
          <p className="mt-3 text-sm text-white/60">No unresolved return or dispute requests.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {recentReturns.map((request) => (
              <div key={request.id} className="rounded-xl border border-white/5 bg-[#1A1A1A] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="font-medium">
                    {request.fulfilment.reference} · {request.reason}
                  </p>
                  <Badge className="bg-amber-500/15 text-amber-200">{request.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-white/60">
                  Order {request.order.orderNumber} · Responsibility {request.responsibility} · Refund {request.refundId ? "requested" : "not requested"}
                </p>
                <p className="mt-2 text-xs text-white/70">{request.reasonNote}</p>
                <SupplierReturnDecisionPanel returnId={request.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-medium">Fulfilment exceptions</h2>
          <Link href="/admin/audit" className="text-xs text-[#FF8C42] hover:underline">
            View audit log
          </Link>
        </div>
        <SupplierFulfilmentBoard initialItems={tasks} isAdmin />
      </section>
    </Container>
  );
}
