"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  Lock,
  ShoppingCart,
  CreditCard,
  TriangleAlert,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { CheckoutSummary } from "@/lib/payments/checkout-summary";
import {
  createCheckoutOrders,
  createSerializedTask,
  PAYMENT_METHODS,
  type CheckoutOrder,
} from "@/lib/payments/checkout-client";
import { formatKes } from "@/utils";
import { KENYA_COUNTIES } from "@/lib/constants";
import { addMoneyCents, isMoneyCents } from "@/lib/money";

/** The cart is split into one payable order per seller. The buyer explicitly
 * accepts the configured rate per order before creating them; payment is a
 * separate action on each order page, where any newer seller quote is shown. */

type Stage = "review" | "creating" | "paying";

export type CheckoutViewProps = {
  summary: CheckoutSummary;
  buyer: { name: string | null; email: string; phone: string | null };
  initialDeliveryCounty?: string | null;
};

export function CheckoutView({ summary, buyer, initialDeliveryCounty }: CheckoutViewProps) {
  const [stage, setStage] = useState<Stage>("review");
  const [deliveryCounty, setDeliveryCounty] = useState(
    KENYA_COUNTIES.find((county) => county.toLowerCase() === initialDeliveryCounty?.trim().toLowerCase()) ?? ""
  );
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryEstimate, setDeliveryEstimate] = useState<{ feeCents: number; county: string } | null>(null);
  const [deliveryEstimateError, setDeliveryEstimateError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [deliveryFeeAccepted, setDeliveryFeeAccepted] = useState(false);
  const [estimateRefresh, setEstimateRefresh] = useState(0);
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);

  const [error, setError] = useState<string | null>(null);

  // Keep one in-flight order-creation request for the current delivery details.
  // The server independently claims the cart transactionally against duplicate requests.
  const createOrdersOnce = useMemo(
    () =>
      createSerializedTask(() =>
        createCheckoutOrders({
          county: deliveryCounty.trim(),
          address: deliveryAddress.trim(),
          acceptedFeeCents: deliveryEstimate?.feeCents ?? -1,
          acceptedSellerCount: summary.sellerCount,
        })
      ),
    [deliveryCounty, deliveryAddress, deliveryEstimate, summary.sellerCount]
  );

  const blockedByStock = summary.unavailableCount > 0;
  const rawDeliveryTotal = deliveryEstimate ? deliveryEstimate.feeCents * summary.sellerCount : null;
  const deliveryTotal = rawDeliveryTotal !== null && Number.isSafeInteger(rawDeliveryTotal) ? rawDeliveryTotal : null;
  const rawCheckoutTotal = deliveryTotal !== null ? summary.subtotalCents + deliveryTotal : null;
  const sellerTotalsValid = deliveryEstimate !== null && summary.groups.every((group) =>
    addMoneyCents(group.subtotalCents, deliveryEstimate.feeCents) !== null);
  const checkoutTotal = summary.amountsValid && sellerTotalsValid && rawCheckoutTotal !== null && Number.isSafeInteger(rawCheckoutTotal)
    ? rawCheckoutTotal : null;
  const invalidTotal = checkoutTotal === null;
  const amountError = !summary.amountsValid || (deliveryEstimate !== null && invalidTotal);
  const totalText = checkoutTotal === null ? (amountError ? "Unavailable" : "Select a county") : formatKes(checkoutTotal);

  useEffect(() => {
    let cancelled = false;
    setDeliveryEstimate(null);
    setDeliveryFeeAccepted(false);
    setDeliveryEstimateError(null);
    const county = deliveryCounty.trim();
    if (!county) { setEstimating(false); return; }
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/orders/delivery-estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ county }),
        });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || body?.success !== true || !isMoneyCents(body?.data?.feeCents) ||
            typeof body.data.county !== "string" || body.data.county.toLowerCase() !== county.toLowerCase() ||
            body.data.currency !== "KES" || body.data.basis !== "PER_SELLER_ORDER") {
          setDeliveryEstimateError(typeof body?.error === "string" ? body.error : "Delivery estimate is unavailable.");
          return;
        }
        setDeliveryEstimate({ feeCents: body.data.feeCents, county: body.data.county });
      } catch {
        if (!cancelled) setDeliveryEstimateError("Could not load the delivery estimate. Please try again.");
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deliveryCounty, estimateRefresh]);

  async function handleCreateOrders() {
    if (stage !== "review") return;

    const county = deliveryCounty.trim();
    const address = deliveryAddress.trim();
    if (!county || !address || address.length < 5) {
      setError("Enter your delivery county and a full delivery address before continuing.");
      return;
    }
    if (!deliveryEstimate || deliveryEstimate.county.toLowerCase() !== county.toLowerCase() || !deliveryFeeAccepted) {
      setError("Review and accept the current delivery estimate before continuing.");
      return;
    }
    if (blockedByStock || invalidTotal) {
      setError("Review your cart. An item is unavailable or an order total is invalid or too large.");
      return;
    }

    setError(null);
    setStage("creating");

    const result = await createOrdersOnce();
    if (!result.ok) {
      setError(result.message);
      setDeliveryFeeAccepted(false);
      setEstimateRefresh((current) => current + 1);
      setStage("review");
      return;
    }
    setOrders(result.data);
    setStage("paying");

  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-6">
          {/* ── Delivery / buyer information ───────────────────────────────── */}
          <section className="glass rounded-xl p-4 sm:rounded-2xl sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" aria-hidden />
              </div>
              <div>
                <h2 className="font-display text-lg font-medium">Delivery details</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Tell the seller where to deliver your order.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                County <span className="text-destructive">*</span>
                <select
                  value={deliveryCounty}
                  onChange={(event) => { setDeliveryEstimate(null); setDeliveryFeeAccepted(false); setDeliveryCounty(event.target.value); }}
                  autoComplete="address-level1"
                  required
                  disabled={stage !== "review"}
                  className="mt-1.5 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                >
                  <option value="">Select a county</option>
                  {KENYA_COUNTIES.map((county) => <option key={county} value={county}>{county}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium sm:col-span-2">
                Delivery address / pickup details <span className="text-destructive">*</span>
                <textarea
                  value={deliveryAddress}
                  onChange={(event) => setDeliveryAddress(event.target.value)}
                  disabled={stage !== "review"}
                  minLength={5}
                  maxLength={300}
                  autoComplete="street-address"
                  placeholder="Town, estate, street, building or agreed pickup point"
                  required
                  rows={3}
                  className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                <span className="mt-1 block text-xs font-normal text-muted-foreground">Up to 300 characters. Do not enter your M-Pesa PIN or payment credentials.</span>
              </label>
            </div>
            <div className="mt-3 rounded-lg border border-border p-3 text-sm" aria-live="polite">
              {deliveryEstimate ? (
                <>
                  <p>Estimated delivery to <strong>{deliveryEstimate.county}</strong>: <strong>{formatKes(deliveryEstimate.feeCents)} per seller order</strong>.</p>
                  <p className="mt-1 text-muted-foreground">{summary.sellerCount} seller {summary.sellerCount === 1 ? "order" : "orders"} × {formatKes(deliveryEstimate.feeCents)} = {deliveryTotal === null ? "—" : formatKes(deliveryTotal)} total estimated delivery.</p>
                  <label className="mt-2 flex items-start gap-2">
                    <input type="checkbox" checked={deliveryFeeAccepted} disabled={stage !== "review"} onChange={(event) => setDeliveryFeeAccepted(event.target.checked)} />
                    <span>I accept this delivery estimate. The final fee may be replaced by a confirmed seller/courier quote, which must be accepted before payment.</span>
                  </label>
                </>
              ) : <p className="text-muted-foreground">{estimating ? "Loading delivery estimate…" : deliveryEstimateError ?? "Select your county to calculate the delivery estimate."}</p>}
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-medium">Your contact details</h3>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
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
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              The county rate is an estimate. A seller may send a different quote before payment; you must review and accept it on that order.
            </p>
          </section>

          {/* ── Your order (server cart, grouped per seller) ───────────────── */}
          <section className="glass rounded-xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-6 sm:py-4">
              <h2 className="font-display text-lg font-medium">Your order</h2>
              {summary.sellerCount > 1 && (
                <Badge variant="cyan">{summary.sellerCount} sellers</Badge>
              )}
            </div>

            <div className="divide-y divide-border">
              {summary.groups.map((group) => (
                <div key={group.sellerId} className="px-4 py-3.5 sm:px-6 sm:py-4">
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
                            Qty {line.quantity} · {isMoneyCents(line.unitPriceCents) ? formatKes(line.unitPriceCents) : "—"} each
                            {!line.isAvailable && (
                              <span className="ml-1 text-destructive">· no longer available</span>
                            )}
                          </p>
                        </div>
                        <p className="shrink-0 font-mono text-sm tabular-nums">
                          {line.isAvailable && summary.amountsValid ? formatKes(line.lineTotalCents) : "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <dl className="space-y-2 border-t border-border px-4 py-4 text-sm sm:px-6">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-mono tabular-nums">{summary.amountsValid ? formatKes(summary.subtotalCents) : "Unavailable"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Estimated delivery ({summary.sellerCount} seller {summary.sellerCount === 1 ? "order" : "orders"})</dt>
                <dd className="font-mono tabular-nums">{deliveryTotal === null ? "Select a county" : formatKes(deliveryTotal)}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 text-base font-medium">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums text-primary-400">
                  {totalText}
                </dd>
              </div>
            </dl>

            {amountError && (
              <p role="alert" className="mx-5 mb-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive sm:mx-6">
                An order amount is invalid or too large. Review your cart or contact support before continuing.
              </p>
            )}
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

          {/* Order pages re-read the latest quote before starting payment. */}
          {stage === "paying" && (
            <section className="glass rounded-2xl p-5 sm:p-6">
              <h2 className="font-display text-lg font-medium">Orders created — review and pay each order</h2>
              <p className="mt-1 text-sm text-muted-foreground">Open each order to check its latest delivery quote and payment status.</p>
              <div className="mt-4 space-y-3">
                {orders.map((order) => (
                  <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
                    <div><p className="font-mono text-sm">{order.orderNumber}</p><p className="text-xs text-muted-foreground">{summary.groups.find((group) => group.sellerId === order.sellerId)?.sellerName} · total when created {formatKes(order.totalCents)}</p></div>
                    <Button asChild size="sm"><Link href={`/buyer/orders/${order.id}`}>Review and pay</Link></Button>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>

        {/* ── Payment method + action ──────────────────────────────────────── */}
        <aside className="w-full lg:w-96">
          <div className="glass rounded-xl p-4 sm:rounded-2xl sm:p-6 lg:sticky lg:top-6">
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
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={method.id}
                      checked
                      readOnly
                      className="sr-only"
                    />
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
                  <dt>Total when created</dt>
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
                onClick={() => void handleCreateOrders()}
                disabled={blockedByStock || summary.totalCents <= 0 || invalidTotal || !deliveryFeeAccepted || !deliveryEstimate || !deliveryCounty.trim() || deliveryAddress.trim().length < 5}
              >
                Create {summary.sellerCount === 1 ? "order" : "orders"} · {totalText}
              </Button>
            )}

            {stage === "creating" && (
              <Button type="button" className="mt-5 w-full" disabled>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Creating your order…
              </Button>
            )}

            {error && (
              <div
                className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs"
                role="alert"
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            {stage === "review" && (
              <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  You will review and pay each order on Paystack’s secure hosted checkout. MaliHub never receives your card details or payment PIN.
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
