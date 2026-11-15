import Image from "next/image";
import Link from "next/link";
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SellerOrderActions } from "@/components/shell/seller/seller-order-actions";
import { ORDER_STATUS_LABEL, isPaidOrderStatus } from "@/lib/order-status";
import { paymentStatusLabel, sellerNextStep } from "@/lib/seller-order-view";
import type { SellerOrder } from "@/modules/orders";
import { formatKes } from "@/utils";

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

/**
 * One seller order, readable without opening other pages: number, date,
 * products, payment status, fulfilment status, tracking, delivery info and
 * the action that applies right now.
 */
export function SellerOrderCard({ order, detailHref }: { order: SellerOrder; detailHref?: string }) {
  const paid = isPaidOrderStatus(order.status);
  const delivery = [order.deliveryAddress, order.deliveryCounty].filter(Boolean).join(", ");

  return (
    <article className="glass rounded-2xl p-4 sm:p-6" aria-label={`Order ${order.orderNumber}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {detailHref ? (
            <Link href={detailHref} className="font-mono text-sm font-medium text-primary-400 hover:underline">
              {order.orderNumber}
            </Link>
          ) : (
            <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
          )}
          <Badge variant={paid ? "primary" : "default"}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          <Badge variant="default">{paymentStatusLabel(order.payment?.status)}</Badge>
        </div>
        <time className="text-xs text-muted-foreground" dateTime={new Date(order.createdAt).toISOString()}>
          {formatDate(order.createdAt)}
        </time>
      </header>

      <ul className="mt-4 flex flex-col gap-3">
        {order.items.map((item) => {
          const image = item.product.images[0]?.url;
          return (
            <li key={item.id} className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {image ? (
                  <Image src={image} alt={item.product.title} width={56} height={56} className="h-14 w-14 object-cover" />
                ) : (
                  <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.product.title}</p>
                <p className="text-xs text-muted-foreground">
                  Qty {item.quantity} × {formatKes(item.unitPriceCents)}
                </p>
              </div>
              <p className="font-mono text-sm tabular-nums">{formatKes(item.totalCents)}</p>
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Order total (incl. delivery)</dt>
          <dd className="font-mono tabular-nums">{formatKes(order.totalCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Buyer</dt>
          <dd>{order.buyer.profile?.fullName ?? "A buyer"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Deliver to</dt>
          <dd>{paid ? delivery || "Not provided" : "Shown once payment is confirmed"}</dd>
        </div>
        {order.shipment && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Tracking</dt>
            <dd>
              {order.shipment.carrierName} ·{" "}
              <span className="font-mono">{order.shipment.trackingNumber}</span>
              {order.shipment.dispatchedAt ? ` · dispatched ${formatDate(order.shipment.dispatchedAt)}` : ""}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
        {sellerNextStep(order.status)}
      </p>

      <SellerOrderActions orderId={order.id} status={order.status} shipment={order.shipment} />
    </article>
  );
}
