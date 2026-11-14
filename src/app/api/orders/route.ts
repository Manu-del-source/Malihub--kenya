import { logServerError } from "@/lib/safe-log";
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
 * seller). The only accepted client fields are a saved delivery address id and the accepted fee;
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
    logServerError("GET /api/orders failed", error);
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
  const addressId = typeof body?.deliveryAddressId === "string" ? body.deliveryAddressId : "";
  const acceptedFeeCents = body?.acceptedDeliveryFeeCents;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(addressId)) {
    return NextResponse.json(
      { success: false, error: "Add or select a valid delivery address before continuing.", code: "invalid_delivery_address" },
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
    const savedAddress = await prisma.deliveryAddress.findFirst({
      where: { id: addressId, userId: user.id },
      select: {
        recipientName: true, phone: true, county: true, subCounty: true, town: true,
        area: true, building: true, landmark: true, instructions: true,
      },
    });
    if (!savedAddress) {
      return NextResponse.json(
        { success: false, error: "That delivery address is no longer available. Choose another address.", code: "delivery_address_not_found" },
        { status: 404 }
      );
    }
    const address = [
      savedAddress.recipientName,
      savedAddress.phone,
      savedAddress.building,
      savedAddress.area,
      savedAddress.town,
      savedAddress.subCounty,
      savedAddress.county,
      savedAddress.landmark ? "Near " + savedAddress.landmark : "",
      savedAddress.instructions,
    ].filter(Boolean).join(", ");
    const result = await checkoutCart(prisma, user.id, {
      county: savedAddress.county,
      address,
      acceptedFeeCents,
    });
    return NextResponse.json(
      {
        success: true,
        data: {
          orders: result.orders.map(({ id, orderNumber, sellerId, status, subtotalCents, totalCents }) => ({
            id, orderNumber, sellerId, status, subtotalCents, totalCents,
          })),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof OrderError) {
      const status =
        error.code === "empty_cart" ? 400 : error.code === "not_found" ? 404 : 409;
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status }
      );
    }
    logServerError("POST /api/orders failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
