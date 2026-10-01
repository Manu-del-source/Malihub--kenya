"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPaymentStatus,
  initiateStkPayment,
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_WINDOW_MS,
  paymentPhaseFromSnapshot,
  validateMpesaPhone,
  type PaymentPhase,
  type StkQueuedResult,
} from "@/lib/payments/checkout-client";
import {
  isSettledSnapshot,
  type BuyerPaymentSnapshot,
  type BuyerPaymentStatusSnapshot,
} from "@/lib/payments/payment-snapshot";

/**
 * One order's M-Pesa collection, from "Pay with M-Pesa" to a confirmed
 * outcome — the state machine the checkout screen and the order screen share.
 *
 * ─── Rules it encodes ───────────────────────────────────────────────────────
 *  - A QUEUED STK response is NEVER success. `pay()` moves to `awaiting` and
 *    only a server-confirmed status (callback or verification) can reach
 *    `succeeded`.
 *  - Polling is bounded: one check every few seconds for a fixed window, then
 *    it stops and the buyer can check again or retry. Nothing polls forever.
 *  - Polling stops the moment the attempt or the order reaches a terminal
 *    state (paid, failed, cancelled, or the order is no longer PENDING).
 *  - A retry never creates a second order: it calls the same STK endpoint
 *    with the same order id, and the service's attempt/idempotency rules
 *    decide whether a new attempt or the existing one answers.
 *  - Concurrent `pay()` calls are refused while one is in flight, and
 *    `autoPay` runs at most once per mount.
 */

export type MpesaPhase =
  | "idle"
  | "initiating"
  | "awaiting"
  | "succeeded"
  | "failed"
  | "timed_out";

export type UseMpesaPaymentOptions = {
  order: { id: string; orderNumber: string; totalCents: number };
  /** Server-rendered state at mount (order page); null when just created. */
  initialSnapshot?: BuyerPaymentSnapshot | null;
  /** Called whenever the snapshot changes (let the parent react/refresh). */
  onSnapshot?: (snapshot: BuyerPaymentStatusSnapshot) => void;
  /** Phone to use for the automatic first attempt (checkout CTA). */
  autoPayPhone?: string | null;
  /** Report the busy/waiting state so siblings can disable themselves. */
  onPhaseChange?: (phase: MpesaPhase) => void;
};

export type UseMpesaPaymentResult = {
  phase: MpesaPhase;
  snapshot: BuyerPaymentSnapshot | null;
  /** Last attempt's identifiers, shown as the payment reference. */
  queued: StkQueuedResult | null;
  message: string | null;
  /** Set when the last failure can be retried on this same order. */
  canRetry: boolean;
  isBusy: boolean;
  phoneError: string | null;
  clearPhoneError: () => void;
  pay: (phone: string) => Promise<boolean>;
  checkNow: () => Promise<void>;
  retry: (phone: string) => Promise<boolean>;
};

export function useMpesaPayment(options: UseMpesaPaymentOptions): UseMpesaPaymentResult {
  const { order, initialSnapshot = null, onSnapshot, autoPayPhone = null, onPhaseChange } = options;

  const [phase, setPhase] = useState<MpesaPhase>(() => paymentPhaseFromSnapshot(initialSnapshot));
  const [snapshot, setSnapshot] = useState<BuyerPaymentSnapshot | null>(initialSnapshot);
  const [queued, setQueued] = useState<StkQueuedResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef(0);
  const autoPayRanRef = useRef(false);

  // Refs to the latest callback/props so the polling closure never goes stale.
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onPhaseChangeRef = useRef(onPhaseChange);
  onPhaseChangeRef.current = onPhaseChange;

  const setPhaseBoth = useCallback((next: MpesaPhase) => {
    setPhase(next);
    onPhaseChangeRef.current?.(next);
  }, []);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  /** Applies a server snapshot; returns true when the outcome is terminal. */
  const applySnapshot = useCallback(
    (next: BuyerPaymentStatusSnapshot): boolean => {
      setSnapshot(next);
      onSnapshotRef.current?.(next);

      const settled = isSettledSnapshot(next);
      if (settled) {
        const nextPhase: PaymentPhase = paymentPhaseFromSnapshot(next);
        if (nextPhase === "succeeded") {
          setPhaseBoth("succeeded");
          setMessage("Payment successful. Your order has been paid.");
        } else if (next.order.status === "CANCELLED") {
          setPhaseBoth("failed");
          setMessage("This order was cancelled, so there is nothing to pay.");
        } else {
          setPhaseBoth("failed");
          setMessage(
            next.payment?.failureReason ??
              "Payment was not completed. You can try M-Pesa again."
          );
        }
        return true;
      }

      if (next.awaitingConfirmation) {
        setPhaseBoth("awaiting");
      }
      return false;
    },
    [setPhaseBoth]
  );

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
      setPhaseBoth("timed_out");
      setMessage(
        "We haven't received M-Pesa confirmation yet. If you completed the payment it will be applied shortly — you can check again."
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

  const pay = useCallback(
    async (phone: string): Promise<boolean> => {
      if (busyRef.current) return false;

      const validation = validateMpesaPhone(phone);
      if (validation) {
        setPhoneError(validation);
        return false;
      }
      setPhoneError(null);

      busyRef.current = true;
      setBusy(true);
      setPhaseBoth("initiating");
      setMessage(null);

      const result = await initiateStkPayment(order.id, phone.trim());
      busyRef.current = false;
      if (!mountedRef.current) return false;
      setBusy(false);

      if (!result.ok) {
        if (result.code === "phone_invalid" || result.code === "phone_required") {
          // The number itself is the problem: show it on the field and let the
          // buyer fix it instead of presenting a payment failure.
          setPhoneError(result.message);
          setPhaseBoth("idle");
          return false;
        }
        setPhaseBoth("failed");
        // `initiateStkPayment` has already mapped the code to buyer-safe copy.
        setMessage(result.message);
        return false;
      }

      setQueued(result.data);
      setPhaseBoth("awaiting");
      setMessage(
        result.data.alreadyInitiated
          ? "An M-Pesa prompt for this order is already active. Enter your M-Pesa PIN on your phone to complete it."
          : "STK Push sent. Check your phone and enter your M-Pesa PIN to complete payment."
      );
      startPolling();
      return true;
    },
    [order.id, setPhaseBoth, startPolling]
  );

  const checkNow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    const result = await fetchPaymentStatus(order.id, { verify: true });

    busyRef.current = false;
    if (!mountedRef.current) return;
    setBusy(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    const terminal = applySnapshot(result.data);
    if (terminal) {
      stopPolling();
      return;
    }
    // A manual check restarts a fresh bounded window — the buyer explicitly
    // asked to keep waiting, so the loop is still finite.
    startPolling();
  }, [order.id, applySnapshot, startPolling, stopPolling]);

  const retry = useCallback((phone: string) => pay(phone), [pay]);

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

  // One automatic attempt for the checkout CTA (which already said "Pay with
  // M-Pesa"). It never fires for an order whose state is already settled.
  useEffect(() => {
    if (!autoPayPhone || autoPayRanRef.current) return;
    if (paymentPhaseFromSnapshot(initialSnapshot) !== "idle") return;
    autoPayRanRef.current = true;
    void pay(autoPayPhone);
  }, [autoPayPhone, initialSnapshot, pay]);

  return {
    phase,
    snapshot,
    queued,
    message,
    canRetry: phase === "failed" || phase === "timed_out" || phase === "idle",
    isBusy: busy,
    phoneError,
    clearPhoneError: () => setPhoneError(null),
    pay,
    checkNow,
    retry,
  };
}
