"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPaymentStatus,
  initiatePaystackCheckout,
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_WINDOW_MS,
  paymentPhaseFromSnapshot,
  type PaymentPhase,
} from "@/lib/payments/checkout-client";
import { resumePaystackTransaction } from "@/lib/payments/paystack-popup";
import {
  isSettledSnapshot,
  type BuyerPaymentSnapshot,
  type BuyerPaymentStatusSnapshot,
} from "@/lib/payments/payment-snapshot";

/**
 * One order's Paystack collection, from "Pay with Paystack (M-Pesa)" to a
 * confirmed outcome — the state machine the checkout screen and the order
 * screen share.
 *
 * ─── Rules it encodes ───────────────────────────────────────────────────────
 *  - The Paystack popup result is NEVER success. `pay()` moves to `awaiting`
 *    and only a server-confirmed status (webhook or the verify endpoint,
 *    which re-verifies the transaction with Paystack) can reach `succeeded`.
 *  - Polling is bounded: one check every few seconds for a fixed window, then
 *    it stops and the buyer can check again or retry. Nothing polls forever.
 *  - Polling stops the moment the attempt or the order reaches a terminal
 *    state (paid, failed, cancelled, or the order is no longer PENDING).
 *  - A retry never creates a second order: it calls the same initialization
 *    endpoint with the same order id, and the service's attempt/idempotency
 *    rules decide whether a new attempt or the existing one answers.
 *  - Concurrent `pay()` calls are refused while one is in flight.
 */

export type PaystackPhase = PaymentPhase | "timed_out";

export type UsePaystackPaymentOptions = {
  order: { id: string; orderNumber: string; totalCents: number; deliveryQuoteVersion: number };
  /** Server-rendered state at mount (order page); null when just created. */
  initialSnapshot?: BuyerPaymentSnapshot | null;
  /** Called whenever the snapshot changes (let the parent react/refresh). */
  onSnapshot?: (snapshot: BuyerPaymentStatusSnapshot) => void;
  /** Report the busy/waiting state so siblings can disable themselves. */
  onPhaseChange?: (phase: PaystackPhase) => void;
};

export type UsePaystackPaymentResult = {
  phase: PaystackPhase;
  snapshot: BuyerPaymentSnapshot | null;
  message: string | null;
  canRetry: boolean;
  isBusy: boolean;
  pay: () => Promise<boolean>;
  checkNow: () => Promise<void>;
  retry: () => Promise<boolean>;
};

export function usePaystackPayment({
  order,
  initialSnapshot = null,
  onSnapshot,
  onPhaseChange,
}: UsePaystackPaymentOptions): UsePaystackPaymentResult {
  const [phase, setPhase] = useState<PaystackPhase>(() => {
    const initial = paymentPhaseFromSnapshot(initialSnapshot);
    if (initial === "idle" || initial === "awaiting") return initial;
    if (initial === "succeeded") return "succeeded";
    return "failed";
  });
  const [snapshot, setSnapshot] = useState<BuyerPaymentSnapshot | null>(initialSnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const setPhaseBoth = useCallback(
    (next: PaystackPhase) => {
      setPhase(next);
      onPhaseChange?.(next);
    },
    [onPhaseChange]
  );

  const applySnapshot = useCallback(
    (next: BuyerPaymentStatusSnapshot): boolean => {
      if (!mountedRef.current) return true;
      setSnapshot(next);
      onSnapshot?.(next);

      if (isSettledSnapshot(next)) {
        const nextPhase: PaymentPhase = paymentPhaseFromSnapshot(next);
        if (nextPhase === "succeeded") {
          setPhaseBoth("succeeded");
          setMessage("Payment successful. Your order has been paid.");
        } else if (next.order.status === "CANCELLED") {
          setPhaseBoth("failed");
          setMessage("This order was cancelled, so there is nothing to pay.");
        } else {
          setPhaseBoth("failed");
          setMessage(next.payment?.failureReason ?? "Payment was not completed. Contact support before starting another checkout.");
        }
        return true;
      }

      if (next.awaitingConfirmation) {
        setPhaseBoth("awaiting");
      }
      return false;
    },
    [setPhaseBoth, onSnapshot]
  );

  /**
   * The settle path: asks the server to re-verify the attempt with Paystack
   * and record the outcome. Called when the popup reports success AND on
   * every poll tick — the popup report is only a hint; the server's answer
   * is the authority.
   */
  const confirm = useCallback(async () => {
    const result = await fetchPaymentStatus(order.id, { verify: true });
    if (!mountedRef.current) return;
    if (result.ok) {
      applySnapshot(result.data);
    } else {
      setMessage(result.message);
    }
  }, [order.id, applySnapshot]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollTick = useCallback(async () => {
    const result = await fetchPaymentStatus(order.id, { verify: true });
    if (!mountedRef.current) return;

    if (result.ok) {
      const terminal = applySnapshot(result.data);
      if (terminal) {
        stopPolling();
        return;
      }
    } else if (result.status === 401 || result.status === 404) {
      // The session or the order is gone; retrying cannot fix either.
      stopPolling();
      setPhaseBoth("failed");
      setMessage(result.message);
      return;
    } else if (result.code === "rate_limited" || result.status === 429) {
      // Bounded by the server's own limiter; keep the local state honest.
      setMessage(result.message);
    }

    if (Date.now() >= deadlineRef.current) {
      stopPolling();
      setPhaseBoth("timed_out");
      setMessage(
        "We haven't received confirmation from Paystack yet. If you completed the payment it will be applied shortly — you can check again."
      );
      return;
    }
    timerRef.current = setTimeout(() => void pollTick(), PAYMENT_POLL_INTERVAL_MS);
  }, [order.id, applySnapshot, stopPolling, setPhaseBoth]);

  const startPolling = useCallback(() => {
    stopPolling();
    deadlineRef.current = Date.now() + PAYMENT_POLL_WINDOW_MS;
    timerRef.current = setTimeout(() => void pollTick(), PAYMENT_POLL_INTERVAL_MS);
  }, [pollTick, stopPolling]);

  const pay = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setPhaseBoth("initiating");
    setMessage(null);

    const result = await initiatePaystackCheckout(order.id, order.deliveryQuoteVersion);
    busyRef.current = false;
    if (!mountedRef.current) return false;
    setBusy(false);

    if (!result.ok) {
      setPhaseBoth("failed");
      setMessage(result.message);
      // Initialization can time out after a reservation was made. Refresh
      // authoritative state so the UI checks that same attempt rather than
      // presenting a fresh payment action.
      const current = await fetchPaymentStatus(order.id);
      if (!mountedRef.current) return false;
      if (current.ok) {
        const settled = applySnapshot(current.data);
        if (!settled && current.data.awaitingConfirmation) startPolling();
      }
      return false;
    }

    const opened = resumePaystackTransaction(result.data.accessCode, {
      onSuccess: () => {
        // The popup says the buyer paid — treat it as "check now", not as
        // proof. The server re-verifies with Paystack before settling.
        void confirm();
      },
      onCancel: () => {
        if (!mountedRef.current) return;
        setPhaseBoth("awaiting");
        setMessage(
          "The Paystack window was closed. Check the payment status before resuming this checkout."
        );
      },
      onError: (error) => {
        if (!mountedRef.current) return;
        setPhaseBoth("failed");
        setMessage(
          error.message?.toLowerCase().includes("cancel")
            ? "The payment window was closed. You can try again."
            : "Paystack could not open the checkout. Please try again."
        );
      },
    });

    if (!opened) {
      // The Paystack script has not finished loading. The attempt exists on
      // the server side; the buyer can resume it by pressing the button
      // again, which reuses the in-flight attempt.
      setPhaseBoth("failed");
      setMessage("We couldn't open the Paystack window yet. Please try again in a moment.");
      return false;
    }

    setPhaseBoth("awaiting");
    setMessage(
      result.data.reused
        ? "A Paystack checkout for this order is already active. Complete it to finish payment."
        : "Complete the payment in the Paystack window. This page updates automatically once it confirms."
    );
    startPolling();
    return true;
  }, [order.id, order.deliveryQuoteVersion, setPhaseBoth, startPolling, confirm, applySnapshot]);

  const checkNow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    await confirm();

    busyRef.current = false;
    if (!mountedRef.current) return;
    setBusy(false);

    // A manual check restarts a fresh bounded window — the buyer explicitly
    // asked to keep waiting, so the loop is still finite.
    if (phase !== "succeeded" && phase !== "failed") {
      startPolling();
    }
  }, [confirm, phase, startPolling]);

  const retry = useCallback(() => pay(), [pay]);

  // Landing on an order whose attempt is still PROCESSING (a buyer returning
  // to the order page) resumes the bounded poll instead of waiting for a
  // manual click.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (paymentPhaseFromSnapshot(initialSnapshot) !== "awaiting") return;
    resumedRef.current = true;
    startPolling();
  }, [initialSnapshot, startPolling]);

  return {
    phase,
    snapshot,
    message,
    canRetry: phase === "failed" || phase === "timed_out" || phase === "idle",
    isBusy: busy,
    pay,
    checkNow,
    retry,
  };
}
