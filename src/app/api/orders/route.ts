import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { checkoutCart, listBuyerOrders, OrderError } from "@/services/order-service";

/**
 * Buyer orders endpoint — the checkout boundary for this phase.
 *
 * `POST /api/orders` converts the caller's cart into PENDING orders (one per
 * seller). The request body is deliberately read for nothing: prices,
 * inventory, seller ids and ownership all come from the database keyed by the
 * session's application user. Payment collection is NOT part of this route —
 * an order is created in `PENDING` and the future payment flow attaches to
 * that row (see `src/services/order-service.ts`).
 */

export async function GET() {
  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    const orders = await listBuyerOrders(prisma, user.id);
    return NextResponse.json({ success: true, data: orders });
  } catch (error) {
    console.error("GET /api/orders failed", error);
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

  // Order-creation spam control: each creation reserves stock and writes
  // rows, so an unbounded scripted buyer could churn orders. The server's
  // single-use cart claim remains the real correctness guarantee; this is
  // the per-buyer rate bound. Fail-open when Redis is not configured, like
  // every other limiter in src/lib/rate-limit.ts.
  const limit = await rateLimit.orderCreate(user.id);
  if (!limit.success) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many orders. Try again ${formatRetryAfter(limit.reset)}.`,
        code: "rate_limited",
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) } }
    );
  }

  try {
    const result = await checkoutCart(prisma, user.id);
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof OrderError) {
      const status =
        error.code === "empty_cart" ? 400 : error.code === "not_found" ? 404 : 409;
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status }
      );
    }
    console.error("POST /api/orders failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
