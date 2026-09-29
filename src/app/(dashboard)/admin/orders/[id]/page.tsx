import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock, Receipt } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  SellerVerificationBadge,
  SettlementStatusBadge,
} from "@/components/shell/admin/admin-badges";
import { formatDateTime } from "@/components/shell/admin/admin-format";
import { requireAdministrator } from "@/lib/auth";
import { getAdminOrderDetail } from "@/services/admin-service";
import { formatKes } from "@/utils";

/**
 * `/admin/orders/[id]` — one order, everything recorded about it, and
 * nothing changeable.
 *
 * Read-only by architectural decision, not by omission: the order lifecycle
 * is owned by the checkout transaction (`src/services/order-service.ts`) and
 * the payment provider boundary — neither exposes an administrative status
 * transition that could be applied safely (stock, order totals and future
 * payment state are derived from the guarded flow), so this screen has no
 * mutation surface to protect. Payments are projected WITHOUT payer handles,
 * raw callbacks, or provider metadata: the admin screen needs the *state* of
 * money, never its credentials.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order — admin" };

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdministrator();

  const { id } = await params;
  const order = await getAdminOrderDetail(id);
  if (!order) notFound();

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="text-sm text-muted-foreground">
        <Link href="/admin/orders" className="hover:text-foreground hover:underline">
          ← Orders
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium">
            Order <span className="font-mono">{order.orderNumber}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {formatDateTime(order.createdAt)} · last changed {formatDateTime(order.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <Badge variant="default">
            <Lock className="h-3 w-3" aria-hidden />
            Read-only
          </Badge>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          {/* ── Line items ─────────────────────────────────────────────── */}
          <section aria-label="Order items" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Items</h2>
            <ul className="mt-4 flex flex-col divide-y divide-border">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 py-3">
                  <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {item.product.images[0] && (
                      <Image
                        src={item.product.images[0].url}
                        alt=""
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/admin/listings/${item.product.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {item.product.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {item.quantity} × {formatKes(item.unitPriceCents)} · condition{" "}
                      {item.product.condition.replace("_", " ").toLowerCase()} · listing now{" "}
                      <span className="font-mono uppercase">{item.product.status}</span>
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    {formatKes(item.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 flex flex-col items-end gap-1 border-t border-border pt-4 text-sm">
              <div className="flex w-56 justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-mono tabular-nums">{formatKes(order.subtotalCents)}</dd>
              </div>
              <div className="flex w-56 justify-between text-base font-medium">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">{formatKes(order.totalCents)}</dd>
              </div>
            </dl>
          </section>

          {/* ── Payments ───────────────────────────────────────────────── */}
          <section aria-label="Payments" className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-medium">Payments</h2>
              <span className="text-xs text-muted-foreground">as recorded; never editable here</span>
            </div>
            {order.payments.length === 0 ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                <Receipt className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                No payment attempt has been recorded for this order. Payment collection runs
                through the provider integration — there is nothing here for an admin to mark paid.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="font-mono uppercase">{payment.method.replace("_", " ")}</span>
                      <span className="text-xs text-muted-foreground">via {payment.provider}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono tabular-nums">
                        {formatKes(payment.amountCents)} {payment.currency}
                      </span>
                      <PaymentStatusBadge status={payment.status} />
                      <span className="text-xs text-muted-foreground">
                        {payment.paidAt ? formatDateTime(payment.paidAt) : formatDateTime(payment.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(order.settlement || order.refunds.length > 0) && (
              <div className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
                {order.settlement && (
                  <div className="rounded-xl border border-border bg-card px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Settlement</p>
                      <SettlementStatusBadge status={order.settlement.status} />
                    </div>
                    <p className="mt-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                      gross {formatKes(order.settlement.grossAmountCents)} · commission{" "}
                      {formatKes(order.settlement.commissionAmountCents)} · net{" "}
                      {formatKes(order.settlement.netAmountCents)}
                    </p>
                  </div>
                )}
                {order.refunds.length > 0 && (
                  <div className="rounded-xl border border-border bg-card px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Refunds</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {order.refunds.map((refund) => (
                        <li key={refund.id} className="flex items-center justify-between font-mono text-xs tabular-nums">
                          <span>{formatKes(refund.amountCents)}</span>
                          <Badge
                            variant="default"
                            className={refund.status === "COMPLETED" ? "text-cyan" : undefined}
                          >
                            {refund.status.replace("_", " ").toLowerCase()}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-label="Buyer" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Buyer</h2>
            <p className="mt-2 text-sm">{order.buyer.profile?.fullName ?? "Unnamed"}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{order.buyer.email}</p>
            <Link
              href={`/admin/users/${order.buyer.id}`}
              className="mt-3 inline-flex items-center rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary-400 transition-colors hover:bg-primary/20"
            >
              Open user record →
            </Link>
          </section>

          <section aria-label="Seller" className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-medium">Seller</h2>
              <SellerVerificationBadge status={order.seller.verificationStatus} />
            </div>
            <p className="mt-2 text-sm">{order.seller.businessName}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">/{order.seller.slug}</span> · {order.seller.county}
            </p>
            <Link
              href={`/admin/sellers/${order.seller.id}`}
              className="mt-3 inline-flex items-center rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary-400 transition-colors hover:bg-primary/20"
            >
              Open seller review →
            </Link>
          </section>

          <section aria-label="Delivery" className="glass rounded-2xl p-6">
            <h2 className="font-display text-lg font-medium">Delivery & notes</h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">County</dt>
                <dd>{order.deliveryCounty ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Address</dt>
                <dd className="whitespace-pre-line">{order.deliveryAddress ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Buyer notes</dt>
                <dd className="whitespace-pre-line">{order.notes ?? "—"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </Container>
  );
}
