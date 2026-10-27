import { logServerError } from "@/lib/safe-log";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { initiatePaystackSchema } from "@/lib/validations/payment";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import {
  createPaystackClient,
  resolvePaystackConfig,
  PaystackClientError,
  isPaystackAccessCode,
  isPaystackReference,
} from "@/lib/payments/paystack";

/**
 * Initialize a Paystack-hosted checkout for the signed-in buyer's own order.
 * All money and identity fields are derived from trusted server-side records.
 * This endpoint never marks an order paid.
 *
 * ─── What the request may and may not carry ────────────────────────────────
 * Accepted: `{ orderId }` — and only that. Refused by design (zod strips it,
 * and the route never reads it): amount, currency, provider, callback URL,
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
    console.error("[payments] Paystack configuration invalid");
    return NextResponse.json({ success: false, error: "Online payments are temporarily unavailable.", code: "provider_not_configured" }, { status: 503 });
  }

  try {
    const order = await prisma.order.findFirst({
      where: { id: orderId, buyerId: user.id },
      select: { id: true, orderNumber: true, status: true, totalCents: true },
    });
    if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    if (order.status === "PAID") return NextResponse.json({ success: false, error: "This order has already been paid." }, { status: 409 });
    if (order.status !== "PENDING") return NextResponse.json({ success: false, error: "This order is not awaiting payment." }, { status: 409 });
    if (!Number.isSafeInteger(order.totalCents) || order.totalCents <= 0) {
      return NextResponse.json({ success: false, error: "This order amount cannot be collected." }, { status: 409 });
    }

    // Reuse an in-flight attempt so a double-click does not create a second
    // provider transaction. The webhook and verify endpoint still decide payment.
    const existing = await prisma.payment.findFirst({
      where: { orderId: order.id, provider: "PAYSTACK", status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, customerReference: true, metadata: true },
    });
    if (existing) {
      const meta = existing.metadata as { paystack?: { authorizationUrl?: string; accessCode?: string } } | null;
      if (isPaystackAccessCode(meta?.paystack?.accessCode) && isPaystackReference(existing.customerReference)) {
        return NextResponse.json({ success: true, data: { accessCode: meta.paystack.accessCode, reference: existing.customerReference, reused: true } });
      }
      // An earlier request may have timed out after Paystack accepted it. Do not
      // blindly create another charge; ask the buyer to retry status/support.
      return NextResponse.json({ success: false, error: "This payment is still being initialized. Please wait a moment and check again.", code: "payment_initializing" }, { status: 409 });
    }

    const reference = `MH-${randomUUID().replace(/-/g, "")}`;
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "PAYSTACK",
        method: "MOBILE_MONEY",
        status: "PENDING",
        amountCents: order.totalCents,
        currency: "KES",
        customerReference: reference,
        retryCount: 0,
        metadata: { paystack: { initialization: "pending" } },
      },
      select: { id: true },
    });

    try {
      const client = createPaystackClient(config.config);
      const initialized = await client.initializeTransaction({
        email: user.email,
        // KES minor units: Paystack documents amounts in the currency's subunit
        // (KES "cent", ×100 of the base amount) — the same unit `totalCents`
        // already is. The webhook/verify paths compare `data.amount` against
        // this same value.
        amountSubunits: order.totalCents,
        reference,
        metadata: { orderNumber: order.orderNumber, paymentId: payment.id },
      });
      if (!isPaystackAccessCode(initialized.access_code) || !isPaystackReference(initialized.reference)) {
        throw new PaystackClientError("Paystack returned invalid transaction identifiers.", "invalid_response");
      }
      // Persist the provider-echoed reference. In the documented path Paystack
      // echoes our custom reference unchanged; if it ever regenerates one, the
      // settlement lookups (webhook service) fall back to this value instead of
      // silently failing to match.
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
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
      return NextResponse.json({
        success: true,
        data: { accessCode: initialized.access_code, reference: initialized.reference, reused: false },
      });
    } catch (error) {
      // Preserve the reserved row/reference: a timeout can be ambiguous, so
      // never create a fresh reference automatically in this request.
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { metadata: { paystack: { initialization: "unknown" } } },
      }).catch(() => undefined);
      if (error instanceof PaystackClientError) {
        const status = error.kind === "not_configured" ? 503 : error.kind === "rejected" ? 502 : 503;
        return NextResponse.json({ success: false, error: "Paystack could not start checkout. Check payment status before retrying.", code: "provider_unavailable" }, { status });
      }
      logServerError("POST /api/payments/paystack/initialize failed", error);
      return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
    }
  } catch (error) {
    logServerError("POST /api/payments/paystack/initialize failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
