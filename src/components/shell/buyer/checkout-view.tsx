"use client";

import { useMemo, useState } from "react";
import Script from "next/script";
import Image from "next/image";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Lock,
  ShoppingCart,
  CreditCard,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";


import type { CheckoutSummary } from "@/lib/payments/checkout-summary";
import {
  createCheckoutOrders,
  createSerializedTask,
  PAYMENT_METHODS,
  initiatePaystackCheckout,
  fetchPaymentStatus,
  type CheckoutOrder,
} from "@/lib/payments/checkout-client";
import { formatKes } from "@/utils";

type PaystackPopupCallbacks = {
  onSuccess: (transaction: { reference: string }) => void;
  onCancel: () => void;
  onError: (error: { message: string }) => void;
};

declare global {
  interface Window {
    PaystackPop?: new () => {
      resumeTransaction: (accessCode: string, callbacks?: PaystackPopupCallbacks) => unknown;
    };
  }
}

/**
 * The checkout screen.
 *
 * ─── Flow ───────────────────────────────────────────────────────────────────
 *  review  → the buyer sees the SERVER's cart and picks M-Pesa, confirms the
 *            phone number, then presses "Pay … with M-Pesa".
 *  creating→ `POST /api/orders` (body `{}`) creates the PENDING order(s) —
 *            one per seller — and reserves stock. Nothing is created before
 *            this click, so merely visiting checkout reserves nothing.
 *  paying  → the created order(s) are shown with the real amounts from the
 *            response and the M-Pesa collection runs against those ids.
 *
 * ─── What the browser never sends ───────────────────────────────────────────
 * No prices, subtotal, total, seller or buyer id, amount, currency or
 * provider setting. The order call sends `{}`; the STK call sends
 * `{ orderId, phoneNumber }`. Everything else is server-derived.
 *
 * ─── Duplicate safety ───────────────────────────────────────────────────────
 * The CTA is disabled while working, the created orders live in component
 * state (pressing "Pay" again cannot re-create them), order creation is
 * single-flighted, and the server's cart claim is the real guarantee: a second
 * checkout of the same cart creates nothing.
 */

type Stage = "review" | "creating" | "paying";

export type CheckoutViewProps = {
  summary: CheckoutSummary;
  buyer: { name: string | null; email: string; phone: string | null };
};

export function CheckoutView({ summary, buyer }: CheckoutViewProps) {
  const [stage, setStage] = useState<Stage>("review");
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);
  
  const [error, setError] = useState<string | null>(null);
  const [paystackReady, setPaystackReady] = useState(false);

  // One order-creation call at a time, for the lifetime of this screen.
  const createOrdersOnce = useMemo(() => createSerializedTask(createCheckoutOrders), []);

  const blockedByStock = summary.unavailableCount > 0;


  async function handlePay() {
    if (stage !== "review") return;

    setError(null);
    setStage("creating");

    const result = await createOrdersOnce();
    if (!result.ok) {
      setError(result.message);
      setStage("review");
      return;
    }
    setOrders(result.data);
    if (result.data.length !== 1) {
      setError("Paystack checkout currently handles one seller order at a time. Please return to your cart and checkout items from one seller at a time. Your orders were created, so check Your orders before retrying.");
      setStage("paying");
      return;
    }
    const payment = await initiatePaystackCheckout(result.data[0]!.id);
    if (!payment.ok) {
      setError(payment.message);
      setStage("paying");
      return;
    }
    if (!window.PaystackPop) {
      setError("Secure checkout is still loading. Please try again in a moment.");
      setStage("paying");
      return;
    }

    try {
      const popup = new window.PaystackPop();
      popup.resumeTransaction(payment.data.accessCode, {
        onSuccess: async () => {
          // The browser callback is not proof of payment. Ask MaliHub's server
          // to verify the transaction before navigating to the order page.
          const verified = await fetchPaymentStatus(result.data[0]!.id, { verify: true });
          if (verified.ok && verified.data.order.status === "PAID") {
            window.location.assign(`/buyer/orders/${result.data[0]!.id}`);
            return;
          }
          setError("Paystack returned from checkout, but MaliHub has not confirmed payment yet. Check Your orders before trying again.");
          setStage("paying");
        },
        onCancel: () => {
          setError("Checkout was closed before payment was confirmed. You can continue from this page.");
          setStage("paying");
        },
        onError: () => {
          setError("Paystack checkout could not load. Your order is still unpaid; please try again or check Your orders first.");
          setStage("paying");
        },
      });
    } catch {
      setError("We couldn't open secure checkout inside MaliHub. Please try again.");
      setStage("paying");
    }
  }

  return (
    <>
    <Script src="https://js.paystack.co/v2/inline.js" strategy="afterInteractive" onReady={() => setPaystackReady(true)} />
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {/* ── Delivery / buyer information ───────────────────────────────── */}
        <section className="glass rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-lg font-medium">Delivery &amp; buyer information</h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
              <dd className="mt-0.5">{buyer.name ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="mt-0.5 break-all">{buyer.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Phone
              </dt>
              <dd className="mt-0.5">{buyer.phone || "Not set"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Delivery is arranged with each seller after payment — MaliHub does not add a delivery
            fee at checkout.
          </p>
        </section>

        {/* ── Your order (server cart, grouped per seller) ───────────────── */}
        <section className="glass rounded-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-lg font-medium">Your order</h2>
            {summary.sellerCount > 1 && (
              <Badge variant="cyan">{summary.sellerCount} sellers</Badge>
            )}
          </div>

          <div className="divide-y divide-border">
            {summary.groups.map((group) => (
              <div key={group.sellerId} className="px-5 py-4 sm:px-6">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Sold by {group.sellerName}
                </p>
                <ul className="mt-3 flex flex-col gap-3">
                  {group.lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                        {line.imageUrl && (
                          <Image
                            src={line.imageUrl}
                            alt={line.title}
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{line.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Qty {line.quantity} · {formatKes(line.unitPriceCents)} each
                          {!line.isAvailable && (
                            <span className="ml-1 text-destructive">· no longer available</span>
                          )}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-sm tabular-nums">
                        {line.isAvailable ? formatKes(line.lineTotalCents) : "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <dl className="space-y-2 border-t border-border px-5 py-4 text-sm sm:px-6">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-mono tabular-nums">{formatKes(summary.subtotalCents)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="text-xs text-muted-foreground">Arranged with the seller</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-base font-medium">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums text-primary-400">
                {formatKes(summary.totalCents)}
              </dd>
            </div>
          </dl>

          {blockedByStock && (
            <div className="mx-5 mb-5 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm sm:mx-6">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <p className="text-amber-600 dark:text-amber-400">
                {summary.unavailableCount === 1
                  ? "One item is no longer available and must be removed before you can pay."
                  : `${summary.unavailableCount} items are no longer available and must be removed before you can pay.`}{" "}
                <Link href="/buyer/cart" className="underline">
                  Back to cart
                </Link>
              </p>
            </div>
          )}
        </section>

        {/* ── Created orders (paying stage) ──────────────────────────────── */}
        {stage === "paying" && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-medium">
                {orders.length === 1 ? "Complete your payment" : "Complete your payments"}
              </h2>
              {orders.length > 1 && <Badge variant="default">{orders.length} orders</Badge>}
            </div>

            {orders.length > 1 && (
              <p className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
                Your cart had items from multiple sellers. Paystack checkout is currently available for one seller order at a time.
              </p>
            )}

            {orders.map((order) => (
              <div key={order.id} className="rounded-xl border border-border p-4 text-sm">
                <p className="font-medium">{order.orderNumber}</p>
                <p className="mt-1 text-muted-foreground">Paystack checkout for {formatKes(order.totalCents)}</p>
              </div>
            ))}

            {false && (
              <div className="rounded-2xl border border-success/40 bg-success/10 p-5">
                <p className="flex items-center gap-2 font-medium text-success">
                  <CheckCircle2 className="h-5 w-5" aria-hidden />
                  {orders.length === 1
                    ? "Payment successful — your order is paid."
                    : "All orders paid."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {orders.map((order) => (
                    <Button key={order.id} asChild size="sm" variant="outline">
                      <Link href={`/buyer/orders/${order.id}`}>{order.orderNumber}</Link>
                    </Button>
                  ))}
                  <Button asChild size="sm">
                    <Link href="/buyer/orders">View all orders</Link>
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Payment method + action ──────────────────────────────────────── */}
      <aside className="w-full lg:w-96">
        <div className="glass sticky top-6 rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-lg font-medium">Payment method</h2>

          <div className="mt-4 flex flex-col gap-3">
            {PAYMENT_METHODS.map((method) => {
              const selected = method.id === "paystack";
              return (
                <label
                  key={method.id}
                  className={`flex cursor-default items-start gap-3 rounded-xl border p-4 ${
                    selected ? "border-primary/50 bg-primary/5" : "border-border"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-primary-400" : "border-border"
                    }`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-primary-400" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <CreditCard className="h-4 w-4 text-primary-400" aria-hidden />
                      {method.label}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {method.description}
                    </span>
                  </span>
                  <input type="radio" name="paymentMethod" value={method.id} checked readOnly className="sr-only" />
                </label>
              );
            })}
            <p className="text-xs text-muted-foreground">
              More payment methods will appear here as they become available.
            </p>
          </div>



          {stage === "paying" && orders.length > 0 && (
            <dl className="mt-5 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Orders created</dt>
                <dd className="font-mono tabular-nums">{orders.length}</dd>
              </div>
              <div className="flex items-center justify-between font-medium">
                <dt>Total to pay</dt>
                <dd className="font-mono tabular-nums text-primary-400">
                  {formatKes(orders.reduce((sum, order) => sum + order.totalCents, 0))}
                </dd>
              </div>
            </dl>
          )}

          {stage === "review" && (
            <Button
              type="button"
              className="mt-5 w-full"
              onClick={() => void handlePay()}
              disabled={blockedByStock || summary.totalCents <= 0 || !paystackReady}
            >
              {paystackReady ? `Pay securely · ${formatKes(summary.totalCents)}` : "Loading secure checkout…"}
            </Button>
          )}

          {stage === "creating" && (
            <Button type="button" className="mt-5 w-full" disabled>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Creating your order…
            </Button>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs" role="alert">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {stage === "review" && (
            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                You will complete payment on Paystack’s secure hosted checkout. MaliHub never receives your card details or payment PIN.
              </span>
            </p>
          )}

          {stage === "review" && (
            <Link
              href="/buyer/cart"
              className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Back to cart
            </Link>
          )}

          {stage === "paying" && (
            <Link
              href="/buyer/orders"
              className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ShoppingCart className="h-3.5 w-3.5" aria-hidden />
              Your orders
            </Link>
          )}
        </div>
      </aside>
    </div>
    </>
  );
}
