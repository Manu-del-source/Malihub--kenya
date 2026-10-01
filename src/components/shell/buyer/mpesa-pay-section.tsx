"use client";

import { useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { useMpesaPayment, type MpesaPhase } from "@/hooks/use-mpesa-payment";
import { PAYMENT_METHODS, paymentAttemptLabel } from "@/lib/payments/checkout-client";
import type { BuyerPaymentSnapshot, BuyerPaymentStatusSnapshot } from "@/lib/payments/payment-snapshot";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { formatKes } from "@/utils";

/**
 * The M-Pesa collection block for ONE order.
 *
 * Shared by the checkout screen (where it receives an order that was just
 * created) and the buyer's order page (where it receives a PENDING order that
 * already exists). It renders the phone field, the action button, and the
 * explicit state of the payment — queued, waiting, successful, failed or
 * awaiting a late confirmation — using the real backend statuses, never a
 * guess. It never reports success from the STK response itself.
 *
 * The component owns no business rules: validation is the shared Kenyan rule,
 * initiation/status calls go through `checkout-client`, and retry simply asks
 * the same order for another attempt (the service enforces the attempt cap and
 * joins an active attempt instead of pushing twice).
 */

const MPESA = PAYMENT_METHODS[0]!;

export type MpesaPaySectionProps = {
  order: { id: string; orderNumber: string; totalCents: number; sellerName?: string | null };
  defaultPhone: string;
  initialSnapshot?: BuyerPaymentSnapshot | null;
  /** Set by the checkout CTA so the first attempt starts without a second click. */
  autoPayPhone?: string | null;
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
  onPhaseChange?: (phase: MpesaPhase) => void;
  onSnapshot?: (snapshot: BuyerPaymentStatusSnapshot) => void;
};

export function MpesaPaySection({
  order,
  defaultPhone,
  initialSnapshot = null,
  autoPayPhone = null,
  disabled = false,
  disabledReason,
  refreshOnSuccess = false,
  onPhaseChange,
  onSnapshot,
}: MpesaPaySectionProps) {
  const router = useRouter();
  const [phone, setPhone] = useState(defaultPhone);
  const payment = useMpesaPayment({
    order,
    initialSnapshot,
    autoPayPhone,
    onPhaseChange,
    onSnapshot,
  });

  const refreshedRef = useRef(false);
  useEffect(() => {
    if (refreshOnSuccess && payment.phase === "succeeded" && !refreshedRef.current) {
      refreshedRef.current = true;
      router.refresh();
    }
  }, [refreshOnSuccess, payment.phase, router]);

  const snapshot = payment.snapshot;
  const amountCents = snapshot?.payment?.amountCents ?? order.totalCents;
  const reference = snapshot?.payment?.customerReference ?? payment.queued?.paymentReference ?? null;
  const phoneLocked =
    payment.phase === "initiating" || payment.phase === "awaiting" || payment.phase === "succeeded";

  function handleSubmit() {
    if (payment.phase === "failed" || payment.phase === "timed_out") {
      void payment.retry(phone);
      return;
    }
    void payment.pay(phone);
  }

  const buttonLabel = (() => {
    if (payment.phase === "initiating") return "Sending M-Pesa request…";
    if (payment.phase === "awaiting") return "Waiting for M-Pesa…";
    if (payment.phase === "failed" || payment.phase === "timed_out") return "Try M-Pesa again";
    return `Pay ${formatKes(amountCents)} with M-Pesa`;
  })();

  return (
    <section className="glass rounded-2xl p-5 sm:p-6" aria-label={`M-Pesa payment for order ${order.orderNumber}`}>
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
        {order.sellerName ? ` · ${order.sellerName}` : ""} · {MPESA.label} via secure STK Push
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
              <dd className="text-foreground">{MPESA.label}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Order status</dt>
              <dd className="text-foreground">
                {snapshot ? ORDER_STATUS_LABEL[snapshot.order.status] : "Paid"}
              </dd>
            </div>
            {snapshot?.payment?.providerReference && (
              <div className="flex justify-between gap-4">
                <dt>M-Pesa receipt</dt>
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
          <div className="mt-4">
            <label htmlFor={`mpesa-phone-${order.id}`} className="text-sm font-medium">
              M-Pesa phone number
            </label>
            <Input
              id={`mpesa-phone-${order.id}`}
              name="phoneNumber"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0712345678"
              className="mt-2"
              value={phone}
              invalid={Boolean(payment.phoneError)}
              disabled={phoneLocked || disabled}
              onChange={(event) => {
                setPhone(event.target.value);
                payment.clearPhoneError();
              }}
            />
            {payment.phoneError && (
              <p className="mt-1.5 text-xs text-destructive" role="alert">
                {payment.phoneError}
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              An STK Push is sent to this number. You can change it before paying.
            </p>
          </div>

          {payment.phase === "awaiting" && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary-400" aria-hidden />
                STK Push sent
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check your phone and enter your M-Pesa PIN to complete payment. This page updates
                automatically once M-Pesa confirms.
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
                {payment.message ??
                  "You can try again — this uses the same order, so you will not be charged twice for one payment."}
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
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={handleSubmit}
              disabled={disabled || payment.isBusy || payment.phase === "awaiting"}
            >
              {payment.isBusy || payment.phase === "awaiting" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {buttonLabel}
            </Button>
            {(payment.phase === "awaiting" || payment.phase === "timed_out") && (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => void payment.checkNow()}
                disabled={payment.isBusy}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Check status
              </Button>
            )}
          </div>

          {disabled && disabledReason && (
            <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p>
          )}
        </>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Your M-Pesa PIN is entered only on the official M-Pesa prompt. MaliHub never asks for
          or stores your M-Pesa PIN.
        </span>
      </p>
    </section>
  );
}
