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
 * seller). The only accepted client fields are delivery county and address;
 * prices, inventory, seller ids and ownership remain server-derived. Payment
 * collection is NOT part of this route —
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

  const body = await request.json().catch(() => null);
  const county = typeof body?.deliveryCounty === "string" ? body.deliveryCounty.trim() : "";
  const address = typeof body?.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  const acceptedFeeCents = body?.acceptedDeliveryFeeCents;

  if (!county || county.length > 80 || !address || address.length < 5 || address.length > 300) {
    return NextResponse.json(
      {
        success: false,
        error: "Enter a county and a delivery address (5–300 characters) before continuing.",
        code: "invalid_delivery_details",
      },
      { status: 400 }
    );
  }

  if (!Number.isSafeInteger(acceptedFeeCents) || acceptedFeeCents < 0) {
    return NextResponse.json(
      { success: false, error: "Review and accept the delivery fee before continuing.", code: "delivery_fee_not_accepted" },
      { status: 400 }
    );
  }

  try {
    const result = await checkoutCart(prisma, user.id, { county, address, acceptedFeeCents });
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
