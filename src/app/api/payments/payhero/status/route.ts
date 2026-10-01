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
 * Buyer payment status for one of the caller's own orders.
 *
 * ─── Why this endpoint exists ───────────────────────────────────────────────
 * Collection already had two trusted channels: PayHero's server-to-server
 * callback and the on-demand transaction-status verification. Neither is
 * reachable from a browser: verification takes a *payment* id and no session,
 * and the callback is provider-facing. The checkout screen needs to ask "has
 * my payment landed yet?" without ever being able to settle anything itself —
 * this route is that doorway, and it only ever answers questions.
 *
 * ─── GET — read-only ────────────────────────────────────────────────────────
 * `GET /api/payments/payhero/status?orderId=…` returns the caller's snapshot
 * from OUR database and performs no provider round-trip and no write. Cheap
 * enough to be polled on a page that is waiting for a callback.
 *
 * ─── POST — verify (server-authoritative) ───────────────────────────────────
 * `POST /api/payments/payhero/status {orderId}` first asks the existing
 * `verifyPayheroPaymentStatus` about a waiting attempt, then returns the
 * refreshed snapshot. Verification can legitimately settle a payment
 * (that is the point — it runs the same conditional claims as the callback),
 * so this method is same-origin guarded like every other mutating route, and
 * rate-limited per buyer because each call may hit PayHero.
 *
 * ─── Trust boundary ─────────────────────────────────────────────────────────
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
    console.error("GET /api/payments/payhero/status failed", error);
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
    console.error("POST /api/payments/payhero/status failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
