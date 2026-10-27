"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Smartphone,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePaystackPayment, type PaystackPhase } from "@/hooks/use-paystack-payment";
import { PAYMENT_METHODS, paymentAttemptBlocksInitiation, paymentAttemptLabel } from "@/lib/payments/checkout-client";
import type { BuyerPaymentSnapshot, BuyerPaymentStatusSnapshot } from "@/lib/payments/payment-snapshot";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { formatKes } from "@/utils";

/**
 * The Paystack collection block for ONE order.
 *
 * Shared by the checkout screen (where it receives an order that was just
 * created) and the buyer's order page (where it receives a PENDING order that
 * already exists). It renders the action button and the explicit state of the
 * payment — awaiting, successful, failed or awaiting a late confirmation —
 * using the real backend statuses, never a guess. It never reports success
 * from the Paystack popup result itself; success requires the server's
 * verification of the transaction.
 *
 * The component owns no business rules: initiation/status calls go through
 * `checkout-client`. The service can resume a sole active attempt; multiple
 * or terminal attempts require support review.
 */

const PAYSTACK = PAYMENT_METHODS[0]!;

export type PaystackPaySectionProps = {
  order: { id: string; orderNumber: string; totalCents: number; deliveryQuoteVersion: number; sellerName?: string | null };
  initialSnapshot?: BuyerPaymentSnapshot | null;
  /** Parent gating (e.g. another order in the same checkout is being paid). */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Re-read the surrounding Server Component once the payment is confirmed.
   * Used by the order page (so its status badge updates); deliberately OFF in
   * the checkout flow, where a refresh would swap the paid orders for the
   * now-empty-cart state mid-flow.
   */
  refreshOnSuccess?: boolean;
  onPhaseChange?: (phase: PaystackPhase) => void;
  onSnapshot?: (snapshot: BuyerPaymentStatusSnapshot) => void;
};

export function PaystackPaySection({
  order,
  initialSnapshot = null,
  disabled = false,
  disabledReason,
  refreshOnSuccess = false,
  onPhaseChange,
  onSnapshot,
}: PaystackPaySectionProps) {
  const router = useRouter();
  const payment = usePaystackPayment({ order, initialSnapshot, onPhaseChange, onSnapshot });

  const refreshedRef = useRef(false);
  useEffect(() => {
    if (refreshOnSuccess && payment.phase === "succeeded" && !refreshedRef.current) {
      refreshedRef.current = true;
      router.refresh();
    }
  }, [refreshOnSuccess, payment.phase, router]);

  const snapshot = payment.snapshot;
  const liveAttempt = snapshot?.payment && ["PENDING", "PROCESSING", "SUCCESS"].includes(snapshot.payment.status);
  const amountCents = liveAttempt ? snapshot!.payment!.amountCents : order.totalCents;
  const reference = snapshot?.payment?.customerReference ?? null;
  const paymentUnavailable = paymentAttemptBlocksInitiation(snapshot);
  const payLocked =
    payment.phase === "initiating" || payment.phase === "awaiting" || payment.phase === "succeeded";

  function handleSubmit() {
    if (payment.phase === "failed" || payment.phase === "timed_out") {
      void payment.retry();
      return;
    }
    void payment.pay();
  }

  const buttonLabel = (() => {
    if (payment.phase === "initiating") return "Opening Paystack…";
    if (payment.phase === "awaiting") return "Waiting for Paystack…";
    if (payment.phase === "failed" || payment.phase === "timed_out") return "Try Paystack again";
    return `Pay ${formatKes(amountCents)} with M-Pesa (Paystack)`;
  })();

  return (
    <section
      className="glass rounded-2xl p-5 sm:p-6"
      aria-label={`Paystack payment for order ${order.orderNumber}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary-400" aria-hidden />
          <h3 className="font-display text-base font-medium">Pay with M-Pesa</h3>
        </div>
        <Badge variant={payment.phase === "succeeded" ? "primary" : "default"}>
          {paymentAttemptLabel(snapshot)}
        </Badge>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Order <span className="font-mono">{order.orderNumber}</span>
        {order.sellerName ? ` · ${order.sellerName}` : ""} · {PAYSTACK.label} secure checkout
      </p>

      {payment.phase === "succeeded" ? (
        <div className="mt-4 rounded-xl border border-success/40 bg-success/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Payment successful
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Your order has been paid.</p>
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between gap-4">
              <dt>Order</dt>
              <dd className="font-mono text-foreground">{order.orderNumber}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Amount paid</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatKes(amountCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Payment method</dt>
              <dd className="text-foreground">{PAYSTACK.label}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Order status</dt>
              <dd className="text-foreground">
                {snapshot ? ORDER_STATUS_LABEL[snapshot.order.status] : "Paid"}
              </dd>
            </div>
            {snapshot?.payment?.providerReference && (
              <div className="flex justify-between gap-4">
                <dt>Paystack receipt</dt>
                <dd className="font-mono text-foreground">{snapshot.payment.providerReference}</dd>
              </div>
            )}
          </dl>
          <Button asChild size="sm" className="mt-4">
            <Link href={`/buyer/orders/${order.id}`}>View order</Link>
          </Button>
        </div>
      ) : (
        <>
          {payment.phase === "awaiting" && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary-400" aria-hidden />
                Awaiting payment
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {snapshot?.payment?.status === "SUCCESS"
                  ? "Payment was received; we are confirming the order. Do not pay again. Contact support if the order remains pending."
                  : snapshot && !snapshot.canInitiate
                    ? "This payment needs review. Do not pay again; check its status or contact support."
                    : <>Complete the payment in the Paystack window (M-Pesa). This page updates
                      automatically once Paystack confirms.</>}
              </p>
              {reference && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reference: <span className="font-mono text-foreground">{reference}</span>
                </p>
              )}
            </div>
          )}

          {(payment.phase === "failed" || payment.phase === "timed_out") && (
            <div
              className={`mt-4 rounded-xl border p-4 ${
                payment.phase === "failed"
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-warning/40 bg-warning/10"
              }`}
              role="status"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                {payment.phase === "failed" ? (
                  <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                ) : (
                  <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
                )}
                {payment.phase === "failed" ? "Payment was not completed." : "No confirmation yet"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {payment.message ?? "Check the order payment status, and contact support before starting another payment."}
              </p>
              {reference && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reference: <span className="font-mono text-foreground">{reference}</span>
                </p>
              )}
              {snapshot && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Attempts used: {snapshot.attempts.used} of {snapshot.attempts.max}
                  {!snapshot.canInitiate ? " — this order cannot start another attempt." : ""}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {!paymentUnavailable && (
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={handleSubmit}
                disabled={disabled || payment.isBusy || payLocked}
              >
                {payment.isBusy || payLocked ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {buttonLabel}
              </Button>
            )}
            {(payment.phase === "awaiting" || payment.phase === "timed_out") && (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => void payment.checkNow()}
                disabled={payment.isBusy}
              >
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                Check status
              </Button>
            )}
          </div>

          {disabled && disabledReason && (
            <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p>
          )}
          {!disabled && paymentUnavailable && payment.phase !== "awaiting" && (
            <p className="mt-2 text-xs text-muted-foreground">Another payment cannot be started for this order. Check its status or contact support.</p>
          )}
        </>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Your M-Pesa PIN is entered only on the official Paystack/M-Pesa prompt. MaliHub never
          asks for or stores your M-Pesa PIN.
        </span>
      </p>
    </section>
  );
}
