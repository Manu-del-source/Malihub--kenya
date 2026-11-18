import Link from "next/link";
import Script from "next/script";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft, MapPin } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBuyerOrder } from "@/services/order-service";
import { readBuyerPaymentSnapshot } from "@/services/payment-status-service";
import { CancelOrderButton } from "@/components/shell/buyer/cancel-order-button";
import { ConfirmOrderReceipt } from "@/components/shell/buyer/confirm-order-receipt";
import { SupplierReturnForm } from "@/components/shell/buyer/supplier-return-form";
import { BUYER_FULFILMENT_SELECT } from "@/lib/dropshipping/selects";
import { BUYER_FULFILMENT_MESSAGE, SUPPLIER_FULFILMENT_LABEL } from "@/lib/dropshipping/fulfilment-state-machine";
import { PaystackPaySection } from "@/components/shell/buyer/paystack-pay-section";
import { paymentAttemptLabel } from "@/lib/payments/checkout-client";
import { formatKes, timeAgo } from "@/utils";
import { ORDER_STATUS_LABEL, isPaidOrderStatus } from "@/lib/order-status";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Order ${id.slice(0, 8)}` };
}

export default async function BuyerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireUser();
  const { id } = await params;

  // Ownership is resolved from the session inside the service: an order that
  // belongs to another buyer comes back null and is answered with 404 — the
  // same response as a nonexistent id, so order ids can't be probed.
  const order = await getBuyerOrder(prisma, user.id, id);
  if (!order) notFound();

  // Payment state for this order, ownership-scoped inside the service. A
  // PENDING order gets the real "Pay with M-Pesa" flow (which retries against
  // THIS order — it never creates another one); a paid order shows its
  // settlement details.
  const paymentSnapshot = await readBuyerPaymentSnapshot(prisma, {
    userId: user.id,
    orderId: order.id,
  });

  const itemSubtotal = order.items.reduce((sum, item) => sum + item.totalCents, 0);

  // Buyer-safe supplier fulfilment projections only: no supplier name, cost,
  // purchase reference, internal notes or delivery evidence is selected.
  const supplierFulfilments = await prisma.supplierFulfilment.findMany({
    where: { orderId: order.id, buyerId: user.id },
    orderBy: { createdAt: "asc" },
    select: BUYER_FULFILMENT_SELECT,
  });

  return (
    <Container className="py-10">
      <Link
        href="/buyer/orders"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All orders
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-medium">{order.orderNumber}</h1>
            <Badge variant={isPaidOrderStatus(order.status) ? "primary" : "default"}>
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {timeAgo(order.createdAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-medium tabular-nums text-primary-400">
            {formatKes(order.totalCents)}
          </p>
          <p className="text-xs text-muted-foreground">
            Sold by {order.seller.businessName}
          </p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
        <section className="glass rounded-2xl">
          <h2 className="border-b border-border px-6 py-4 font-display text-lg font-medium">
            Items
          </h2>
          <div className="divide-y divide-border">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <Link
                    href={`/products/${item.product.slug}`}
                    className="block truncate text-sm font-medium hover:text-primary-400"
                  >
                    {item.product.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatKes(item.unitPriceCents)} × {item.quantity}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm tabular-nums">
                  {formatKes(item.totalCents)}
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-border px-6 py-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono tabular-nums">{formatKes(itemSubtotal)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatKes(order.totalCents)}</span>
            </div>
          </div>
        </section>

        {(order.status === "SHIPPED" || order.status === "DELIVERED") && (
          <ConfirmOrderReceipt orderId={order.id} />
        )}

        {supplierFulfilments.length > 0 && (
          <section className="glass rounded-2xl p-5 text-sm">
            <h2 className="font-display text-base font-medium">Supplier fulfilment updates</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Tracking is entered manually. A supplier dispatch claim is not proof of delivery.
            </p>
            <div className="mt-4 space-y-4">
              {supplierFulfilments.map((fulfilment) => (
                <div key={fulfilment.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{fulfilment.product.title}</p>
                    <Badge variant="primary">
                      {SUPPLIER_FULFILMENT_LABEL[fulfilment.status]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    {BUYER_FULFILMENT_MESSAGE[fulfilment.status]}
                  </p>
                  {fulfilment.carrierName && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Courier: {fulfilment.carrierName}
                      {fulfilment.trackingNumber ? ` · ${fulfilment.trackingNumber}` : ""}
                      {fulfilment.trackingUrl ? ` · ${fulfilment.trackingUrl}` : ""}
                    </p>
                  )}
                  {fulfilment.deliveredAt && (
                    <p className="mt-2 text-xs text-emerald-500">
                      Delivery reviewed {new Date(fulfilment.deliveredAt).toLocaleString()}.
                    </p>
                  )}
                  {fulfilment.returnRequest ? (
                    <p className="mt-2 text-xs text-amber-500">
                      Your return/dispute request is {fulfilment.returnRequest.status.toLowerCase()}. No refund is guaranteed until the payment provider confirms it.
                    </p>
                  ) : fulfilment.status !== "AWAITING_PAYMENT" &&
                    fulfilment.status !== "CANCELLED" ? (
                    <div className="rounded-xl border border-border bg-card/40 p-3">
                      <SupplierReturnForm fulfilmentId={fulfilment.id} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )}
        </div>

        <aside className="flex flex-col gap-4">
          {order.status === "PENDING" && (
            <>
              <Script
                src="https://js.paystack.co/v2/inline.js"
                strategy="afterInteractive"
              />
              <PaystackPaySection
                order={{
                  id: order.id,
                  orderNumber: order.orderNumber,
                  totalCents: order.totalCents,
                  sellerName: order.seller.businessName,
                }}
                initialSnapshot={paymentSnapshot}
                refreshOnSuccess
              />
            </>
          )}

          <div className="glass rounded-2xl p-5 text-sm">
            <h2 className="font-display text-base font-medium">Status</h2>
            {order.status === "PENDING" ? (
              <p className="mt-2 font-medium text-amber-500">Payment required</p>
            ) : null}
            <p className="mt-2 text-muted-foreground">
              {order.status === "PENDING"
                ? "This order is awaiting payment — nothing has been charged yet. Pay with M-Pesa above, or cancel the order."
                : order.status === "PAID"
                  ? "Payment confirmed. The seller is preparing your order for dispatch."
                  : order.status === "SHIPPED"
                    ? "Your order has been dispatched. Courier name and tracking number are shown above. Follow the courier updates, then confirm receipt here once the parcel is physically with you."
                    : order.status === "DELIVERED"
                      ? "The seller has marked this order delivered. Confirm receipt only after you have physically received and checked it."
                      : order.status === "COMPLETED"
                        ? "You confirmed receipt. This order is complete."
                        : `This order is ${ORDER_STATUS_LABEL[order.status]?.toLowerCase() ?? order.status.toLowerCase()}.`}
            </p>

            {(order.shipment || order.status === "SHIPPED") && (
              <div className="mt-4 rounded-xl border border-primary-400/30 bg-primary-400/5 p-4">
                <h3 className="font-medium">Courier and tracking details</h3>
                {order.shipment ? (
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted-foreground">Courier</dt>
                      <dd className="font-medium text-foreground">{order.shipment.carrierName}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted-foreground">Tracking number</dt>
                      <dd className="break-all font-mono text-foreground">{order.shipment.trackingNumber}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted-foreground">Shipment status</dt>
                      <dd className="text-foreground">{order.shipment.status.replaceAll("_", " ").toLowerCase()}</dd>
                    </div>
                    {order.shipment.dispatchedAt && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-muted-foreground">Dispatched</dt>
                        <dd className="text-foreground">{timeAgo(order.shipment.dispatchedAt)}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-amber-500">
                    The seller marked this order as shipped, but courier and tracking details have not been recorded. Contact the seller or MaliHub support.
                  </p>
                )}
                {order.shipment?.trackingUrl && (
                  <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-flex text-sm font-medium text-primary-400 hover:underline">
                    Track parcel with courier →
                  </a>
                )}
              </div>
            )}

            {paymentSnapshot?.payment && (
              <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>Payment</dt>
                  <dd className="text-right text-foreground">
                    {paymentAttemptLabel(paymentSnapshot)}
                  </dd>
                </div>
                {paymentSnapshot.payment.providerReference && (
                  <div className="flex justify-between gap-3">
                    <dt>M-Pesa receipt</dt>
                    <dd className="font-mono text-foreground">
                      {paymentSnapshot.payment.providerReference}
                    </dd>
                  </div>
                )}
                {paymentSnapshot.payment.paidAt && (
                  <div className="flex justify-between gap-3">
                    <dt>Paid</dt>
                    <dd className="text-foreground">{timeAgo(paymentSnapshot.payment.paidAt)}</dd>
                  </div>
                )}
                {order.status === "PENDING" && (
                  <div className="flex justify-between gap-3">
                    <dt>Attempts</dt>
                    <dd className="text-foreground">
                      {paymentSnapshot.attempts.used} of {paymentSnapshot.attempts.max}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {order.status === "PENDING" && (
              <div className="mt-4">
                <CancelOrderButton orderId={order.id} />
              </div>
            )}
          </div>

          {order.deliveryCounty && (
            <div className="glass rounded-2xl p-5 text-sm">
              <h2 className="font-display text-base font-medium">Delivery</h2>
              <p className="mt-2 flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {order.deliveryAddress ? `${order.deliveryAddress}, ` : ""}
                  {order.deliveryCounty}
                </span>
              </p>
            </div>
          )}

          <div className="glass rounded-2xl p-5 text-sm">
            <h2 className="font-display text-base font-medium">Need help?</h2>
            <p className="mt-2 text-muted-foreground">
              Message the seller from your conversations — every order ties back to the
              seller&apos;s shop.
            </p>
            <Link
              href="/messages"
              className="mt-3 inline-block text-sm text-primary-400 hover:underline"
            >
              Open messages →
            </Link>
          </div>
        </aside>
      </div>
    </Container>
  );
}
