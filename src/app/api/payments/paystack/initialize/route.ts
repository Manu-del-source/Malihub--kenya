import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { initiatePaystackSchema } from "@/lib/validations/payment";
import { PaymentInitializationError, reservePaystackPayment } from "@/services/payment-initialization-service";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import {
  createPaystackClient,
  resolvePaystackConfig,
  PaystackClientError,
} from "@/lib/payments/paystack";

/**
 * Initialize a Paystack-hosted checkout for the signed-in buyer's own order.
 * All money and identity fields are derived from trusted server-side records.
 * This endpoint never marks an order paid.
 *
 * ─── What the request may and may not carry ────────────────────────────────
 * Accepted: `{ orderId, quoteVersion }`. The version is checked as a stale-view
 * precondition, never used as a price. Refused: amount, currency, provider, callback URL,
 * buyer id, payment status. The amount comes from the order row, the buyer
 * email from the session, and every provider setting from server
 * configuration.
 *
 * ─── Success response ──────────────────────────────────────────────────────
 * A 200 here means Paystack created the transaction and handed back an access
 * code. The buyer still has to complete the hosted checkout, and the order
 * becomes PAID only when the signed webhook (or a server-side verification)
 * confirms collection. This response deliberately never reports the order as
 * paid.
 *
 * ─── Duplicate safety ──────────────────────────────────────────────────────
 * An in-flight attempt (PENDING/PROCESSING) is reused instead of creating a
 * second provider transaction, so a double-click cannot fork into two charges
 * for the same money. The webhook and verify endpoint — not this route —
 * decide payment.
 */
export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ success: false, error: "Your account needs an email address to pay." }, { status: 400 });
  }

  // Cross-order bound on provider transaction creation; fail-open when Redis
  // is not configured, like every other limiter in src/lib/rate-limit.ts.
  // The in-flight-attempt reuse below is the per-order hard bound.
  const limit = await rateLimit.paymentInitiate(user.id);
  if (!limit.success) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many payment attempts. Try again ${formatRetryAfter(limit.reset)}.`,
        code: "rate_limited",
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const input = initiatePaystackSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json(
      { success: false, error: input.error.issues[0]?.message ?? "A valid orderId is required." },
      { status: 400 }
    );
  }
  const orderId = input.data.orderId;

  const config = resolvePaystackConfig({
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
    PAYSTACK_CALLBACK_URL: process.env.PAYSTACK_CALLBACK_URL,
    PAYSTACK_TIMEOUT_MS: process.env.PAYSTACK_TIMEOUT_MS,
  });
  if (!config.ok) {
    console.error("[payments] Paystack configuration invalid", config);
    return NextResponse.json({ success: false, error: "Online payments are temporarily unavailable.", code: "provider_not_configured" }, { status: 503 });
  }

  let reservation;
  try {
    reservation = await reservePaystackPayment(prisma, { userId: user.id, orderId, quoteVersion: input.data.quoteVersion });
  } catch (error) {
    if (error instanceof PaymentInitializationError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code },
        { status: error.code === "not_found" ? 404 : 409 });
    }
    console.error("POST /api/payments/paystack/initialize reservation failed", error);
    return NextResponse.json({ success: false, error: "Could not start payment." }, { status: 500 });
  }
  if (reservation.kind === "reused") {
    return NextResponse.json({ success: true, data: { accessCode: reservation.accessCode, reference: reservation.reference, reused: true } });
  }
  const { paymentId, reference, amountCents, orderNumber } = reservation;

  try {
    // Bind the configured callback to THIS order. A multi-seller checkout has
    // multiple orders, so selecting the buyer's newest order on return would
    // show the wrong amount/receipt for earlier seller orders.
    const callbackUrl = new URL(config.config.callbackUrl);
    callbackUrl.searchParams.set("orderId", orderId);
    const client = createPaystackClient({ ...config.config, callbackUrl: callbackUrl.toString() });
    const initialized = await client.initializeTransaction({
      email: user.email,
      // KES minor units: Paystack documents amounts in the currency's subunit
      // (KES "cent", ×100 of the base amount) — the same unit `totalCents`
      // already is. The webhook/verify paths compare `data.amount` against
      // this same value.
      amountSubunits: amountCents,
      reference,
      metadata: { orderNumber, paymentId },
    });
    // Persist the provider-echoed reference. In the documented path Paystack
    // echoes our custom reference unchanged; if it ever regenerates one, the
    // settlement lookups (webhook service) fall back to this value instead of
    // silently failing to match.
    const persisted = await prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: {
        status: "PROCESSING",
        metadata: {
          paystack: {
            accessCode: initialized.access_code,
            authorizationUrl: initialized.authorization_url,
            providerReference: initialized.reference,
            initialization: "accepted",
          },
        },
      },
    });
    if (persisted.count !== 1) {
      // A concurrent verification/webhook may have settled the reservation
      // while Paystack was responding. Never hand out a checkout whose local
      // payment is no longer the active attempt.
      return NextResponse.json({ success: false, error: "Payment status changed while checkout was starting. Check the order before paying.", code: "payment_state_changed" }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      data: { accessCode: initialized.access_code, reference: initialized.reference, reused: false },
    });
  } catch (error) {
    // Preserve the reserved row/reference: a timeout can be ambiguous, so
    // never create a fresh reference automatically in this request.
    await prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { metadata: { paystack: { initialization: "unknown" } } },
    }).catch(() => undefined);
    if (error instanceof PaystackClientError) {
      const status = error.kind === "not_configured" ? 503 : error.kind === "rejected" ? 502 : 503;
      return NextResponse.json({ success: false, error: "Paystack could not start checkout. Check payment status before retrying.", code: "provider_unavailable" }, { status });
    }
    console.error("POST /api/payments/paystack/initialize failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
