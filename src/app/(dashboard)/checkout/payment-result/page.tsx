import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Loader2, TriangleAlert, ExternalLink } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyBuyerPaymentStatus } from "@/services/payment-status-service";
import { paymentPhaseFromSnapshot } from "@/lib/payments/checkout-client";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { formatKes } from "@/utils";
import { z } from "zod";

/**
 * The browser's landing page after Paystack's hosted checkout.
 *
 * Paystack's `callback_url` (PAYSTACK_CALLBACK_URL) sends the BUYER'S BROWSER
 * here when the hosted checkout closes — paid or not. That redirect is a
 * navigation convenience, NOT a payment signal: this page trusts nothing the
 * browser saw, and asks MaliHub's server for the real state, which
 * (server-side) re-verifies the waiting attempt against Paystack's API.
 *
 * Rendered per request — never prerendered: the route reads the session.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payment result" };

export default async function PaymentResultPage({ searchParams }: {
  searchParams: Promise<{ orderId?: string | string[]; reference?: string | string[] }>;
}) {
  const { user } = await requireUser();
  const query = await searchParams;
  const orderId = typeof query.orderId === "string" && z.string().uuid().safeParse(query.orderId).success ? query.orderId : null;
  const reference = typeof query.reference === "string" && /^[A-Za-z0-9.=-]{1,100}$/.test(query.reference) ? query.reference : null;
  const select = { id: true, orderNumber: true, status: true, subtotalCents: true, deliveryFeeCents: true, totalCents: true } as const;
  // Older provider sessions may not include our new orderId parameter. If
  // they return our reference, resolve it through a payment owned by the user.
  // Never guess by taking the latest of multiple seller orders.
  const order = orderId
    ? await prisma.order.findFirst({ where: { id: orderId, buyerId: user.id }, select })
    : reference
      ? (await prisma.payment.findFirst({ where: { customerReference: reference, order: { buyerId: user.id } }, select: { order: { select } } }))?.order ?? null
      : null;
  if (!order) {
    return (
      <Container className="py-16 text-center">
        <h1 className="font-display text-2xl font-medium">Check your payment</h1>
        <p className="mt-2 text-sm text-muted-foreground">We could not identify an order from this return link. Open your orders to check the correct payment status.</p>
        <Button asChild className="mt-5"><Link href="/buyer/orders">Your orders</Link></Button>
      </Container>
    );
  }

  // Server-authoritative state. When the attempt is still waiting on the
  // provider this performs the Paystack round-trip right now — the webhook
  // may not have arrived yet, and the buyer should not have to guess.
  const snapshot = await verifyBuyerPaymentStatus(prisma, {
    userId: user.id,
    orderId: order.id,
  });

  const currentStatus = snapshot?.order.status ?? order.status;
  const currentTotal = snapshot?.order.totalCents ?? order.totalCents;
  const phase = paymentPhaseFromSnapshot(snapshot);
  const paid = phase === "succeeded";
  const waiting = phase === "awaiting" || snapshot?.verification?.ok === false;

  return (
    <Container className="flex flex-col items-center py-16">
      <div className="glass w-full max-w-lg rounded-2xl p-6 text-center sm:p-8">
        {paid ? (
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
        ) : waiting ? (
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary-400" aria-hidden />
        ) : (
          <TriangleAlert className="mx-auto h-12 w-12 text-warning" aria-hidden />
        )}

        <h1 className="mt-4 font-display text-2xl font-medium">
          {paid
            ? "Payment confirmed"
            : waiting
              ? "Confirming your payment…"
              : "Payment not completed"}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          {paid
            ? "Your payment was verified and the order is paid. The seller will arrange delivery with you."
            : waiting
              ? "We are checking the payment with Paystack. This usually takes a few seconds — do not pay again from this page."
              : "We cannot confirm this order as paid. Check the order page, and contact support if you were charged."}
        </p>

        <dl className="mt-6 space-y-2 rounded-xl border border-border p-4 text-left text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Order</dt>
            <dd className="font-mono text-foreground">{order.orderNumber}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-mono tabular-nums text-foreground">{formatKes(order.subtotalCents)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="font-mono tabular-nums text-foreground">{formatKes(order.deliveryFeeCents)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-mono tabular-nums text-foreground">{formatKes(currentTotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Order status</dt>
            <dd>
              <Badge variant={paid ? "primary" : "default"}>
                {ORDER_STATUS_LABEL[currentStatus as keyof typeof ORDER_STATUS_LABEL] ?? currentStatus}
              </Badge>
            </dd>
          </div>
          {snapshot?.payment?.providerReference && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Paystack receipt</dt>
              <dd className="font-mono text-foreground">{snapshot.payment.providerReference}</dd>
            </div>
          )}
        </dl>

        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild>
            <Link href={`/buyer/orders/${order.id}`}>
              View order
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/buyer/orders">All orders</Link>
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          If you completed payment and the status still says waiting after a minute, open the
          order page and press Check status — the server re-verifies with Paystack.
        </p>
      </div>
    </Container>
  );
}
