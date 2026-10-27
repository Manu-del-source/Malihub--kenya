import { logServerError } from "@/lib/safe-log";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { paymentStatusRequestSchema } from "@/lib/validations/payment";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import {
  readBuyerPaymentSnapshot,
  verifyBuyerPaymentStatus,
} from "@/services/payment-status-service";

/**
 * Buyer payment verification for one of the caller's own orders — the
 * server-authoritative "has my payment landed?" endpoint.
 *
 * ─── Why this endpoint exists ──────────────────────────────────────────────
 * Settlement has two trusted channels: Paystack's signed webhook (push) and
 * this on-demand verification (pull). Neither is reachable from a browser on
 * its own terms: the webhook is provider-facing and signature-gated, and
 * verification takes a *payment* id resolved from the session. The checkout
 * and order screens use THIS route to ask "has my payment landed yet?" — and
 * it can only ever ask the SERVER, which asks PAYSTACK. The browser's claim
 * of success (the checkout popup's `onSuccess`) has no power here: it merely
 * triggers a POST to this route, and the server decides the outcome by
 * re-verifying the transaction against Paystack's API with the secret key.
 *
 * ─── GET — read-only ───────────────────────────────────────────────────────
 * `GET /api/payments/paystack/verify?orderId=…` returns the caller's snapshot
 * from OUR database and performs no provider round-trip and no write. Cheap
 * enough to be polled on a page that is waiting for the webhook.
 *
 * ─── POST — verify (server-authoritative, settlement-capable) ──────────────
 * `POST /api/payments/paystack/verify {orderId}` asks
 * `verifyPaystackPaymentStatus` about the order's waiting attempt (Paystack
 * `GET /transaction/verify/{reference}`, amount and currency re-checked
 * against the order row) and then returns the refreshed snapshot. This can
 * legitimately settle the payment — through the same conditional claims the
 * webhook uses — so this method is same-origin guarded like every other
 * mutating route, and rate-limited per buyer because each call may hit
 * Paystack.
 *
 * ─── Trust boundary ────────────────────────────────────────────────────────
 * The body carries ONE field, the order id, and it is only ever used together
 * with the session's user id (`{ id, buyerId: userId }`). A payment id, buyer
 * id, amount or status in a request is not read and could not steer anything.
 * Another buyer's order id answers exactly like a nonexistent one: 404, with
 * no existence oracle and no body that distinguishes the two.
 */

function badRequest(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const input = paymentStatusRequestSchema.safeParse({
    orderId: request.nextUrl.searchParams.get("orderId") ?? "",
  });
  if (!input.success) {
    return badRequest(input.error.issues[0]?.message ?? "Invalid request.");
  }

  try {
    const snapshot = await readBuyerPaymentSnapshot(prisma, {
      userId: user.id,
      orderId: input.data.orderId,
    });
    if (!snapshot) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { ...snapshot, verification: null } });
  } catch (error) {
    logServerError("GET /api/payments/paystack/verify failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  // Cross-order bound on provider round-trips; fail-open when Redis is not
  // configured, like every other limiter in src/lib/rate-limit.ts.
  const limit = await rateLimit.paymentStatusCheck(user.id);
  if (!limit.success) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many status checks. Try again ${formatRetryAfter(limit.reset)}.`,
        code: "rate_limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const input = paymentStatusRequestSchema.safeParse(body);
  if (!input.success) {
    return badRequest(input.error.issues[0]?.message ?? "Invalid request.");
  }

  try {
    const snapshot = await verifyBuyerPaymentStatus(prisma, {
      userId: user.id,
      orderId: input.data.orderId,
    });
    if (!snapshot) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: snapshot });
  } catch (error) {
    logServerError("POST /api/payments/paystack/verify failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
