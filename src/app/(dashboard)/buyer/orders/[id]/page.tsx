import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft, MapPin, ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBuyerOrder } from "@/services/order-service";
import { readBuyerPaymentSnapshot } from "@/services/payment-status-service";
import { CancelOrderButton } from "@/components/shell/buyer/cancel-order-button";
import { MpesaPaySection } from "@/components/shell/buyer/mpesa-pay-section";
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
            {order.seller.verificationStatus === "VERIFIED" && (
              <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-cyan" aria-hidden />
            )}
          </p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
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

        <aside className="flex flex-col gap-4">
          {order.status === "PENDING" && (
            <MpesaPaySection
              order={{
                id: order.id,
                orderNumber: order.orderNumber,
                totalCents: order.totalCents,
                sellerName: order.seller.businessName,
              }}
              defaultPhone={user.phone ?? ""}
              initialSnapshot={paymentSnapshot}
              refreshOnSuccess
            />
          )}

          <div className="glass rounded-2xl p-5 text-sm">
            <h2 className="font-display text-base font-medium">Status</h2>
            {order.status === "PENDING" ? (
              <p className="mt-2 font-medium text-amber-500">Payment required</p>
            ) : null}
            <p className="mt-2 text-muted-foreground">
              {order.status === "PENDING"
                ? "This order is awaiting payment — nothing has been charged yet. Pay with M-Pesa above, or cancel the order."
                : isPaidOrderStatus(order.status)
                  ? "This order has been paid. The seller will arrange delivery with you."
                  : `This order is ${ORDER_STATUS_LABEL[order.status]?.toLowerCase() ?? order.status.toLowerCase()}.`}
            </p>

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
