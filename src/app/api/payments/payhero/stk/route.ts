import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { initiateStkSchema } from "@/lib/validations/payment";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import {
  initiatePayheroStk,
  PaymentServiceError,
  type PaymentServiceErrorCode,
} from "@/services/payment-service";

/**
 * `POST /api/payments/payhero/stk` — start (or join) M-Pesa STK collection
 * for the signed-in buyer's own PENDING order.
 *
 * ─── What the request may and may not carry ────────────────────────────────
 * Accepted: `{ orderId, phoneNumber? }` — and the phone is validated against
 * the same rule onboarding enforces. Refused by design (zod strips them, and
 * the service never reads them): amount, currency, provider, channel id,
 * callback URL, buyer id, payment status. The amount comes from the order row
 * inside the service transaction, the provider/channel/callback from server
 * configuration, and the buyer from the session.
 *
 * ─── Success response ──────────────────────────────────────────────────────
 * A 200 here means PayHero QUEUED the STK prompt — the buyer still has to
 * enter their M-Pesa PIN, and the order becomes PAID only when the verified
 * callback (or a status verification) confirms collection. This response
 * deliberately never reports the order as paid.
 *
 * ─── Error mapping ─────────────────────────────────────────────────────────
 * `not_found` doubles as "exists but isn't yours" (no order-id oracle), as on
 * the order routes. Provider failures are 502/503 without provider internals,
 * and anything unexpected is a 500 with no stack.
 */
const STK_ERROR_STATUS: Record<PaymentServiceErrorCode, number> = {
  not_found: 404,
  not_payable: 409,
  already_paid: 409,
  invalid_amount: 409,
  phone_required: 400,
  phone_invalid: 400,
  provider_not_configured: 503,
  provider_rejected: 502,
  provider_unavailable: 503,
  provider_invalid_response: 502,
  attempt_limit: 429,
};

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  // Cross-order anti-spam window (the per-order attempt cap lives in the
  // service; this is the per-buyer bound). Fail-open by design of the
  // rate-limit module when Redis is not configured.
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

  const input = initiateStkSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json(
      { success: false, error: input.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  try {
    const result = await initiatePayheroStk(prisma, {
      actor: { userId: user.id, email: user.email, accountPhone: user.phone },
      orderId: input.data.orderId,
      ...(input.data.phoneNumber ? { phoneNumber: input.data.phoneNumber } : {}),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          paymentReference: result.payment.customerReference,
          checkoutRequestId: result.payment.providerTransactionId,
          paymentStatus: result.payment.status,
          amountCents: result.payment.amountCents,
          alreadyInitiated: result.outcome === "already_initiated",
          // Explicit about the only thing the client needs to understand:
          // the prompt may be on its way; the money is NOT collected yet.
          providerStatus: "QUEUED",
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: STK_ERROR_STATUS[error.code] }
      );
    }

    console.error("POST /api/payments/payhero/stk failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
