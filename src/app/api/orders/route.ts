import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { checkoutDeliverySchema } from "@/lib/validations/delivery";
import { checkoutCart, listBuyerOrders, OrderError } from "@/services/order-service";

/**
 * Buyer orders endpoint — the checkout boundary for this phase.
 *
 * `POST /api/orders` converts the caller's cart into PENDING orders (one per
 * seller). The client supplies delivery details plus its acknowledgement of
 * the displayed estimate and seller count; the server re-prices both. Product
 * prices, inventory, seller ids and ownership remain server-derived. Payment
 * is initialized separately against the resulting PENDING order.
 */

export async function GET() {
  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    const orders = await listBuyerOrders(prisma, user.id);
    return NextResponse.json({ success: true, data: orders.map((order) => ({
      id: order.id, orderNumber: order.orderNumber, status: order.status,
      subtotalCents: order.subtotalCents, totalCents: order.totalCents,
      deliveryCounty: order.deliveryCounty, deliveryAddress: order.deliveryAddress,
      deliveryEstimateCents: order.deliveryEstimateCents, deliveryFeeCents: order.deliveryFeeCents,
      deliveryFeeStatus: order.deliveryFeeStatus, deliveryFeeAcceptedAt: order.deliveryFeeAcceptedAt,
      deliveryQuoteCents: order.deliveryQuoteCents, deliveryQuoteNote: order.deliveryQuoteNote,
      deliveryQuoteUpdatedAt: order.deliveryQuoteUpdatedAt, deliveryQuoteVersion: order.deliveryQuoteVersion,
      createdAt: order.createdAt, seller: order.seller,
      items: order.items.map((item) => ({ id: item.id, quantity: item.quantity,
        unitPriceCents: item.unitPriceCents, totalCents: item.totalCents, product: item.product })),
    })) });
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
  const parsed = checkoutDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter valid delivery details and review the estimate for each seller.", code: "invalid_delivery_details" },
      { status: 400 }
    );
  }
  const { deliveryCounty: county, deliveryAddress: address, acceptedDeliveryFeeCents: acceptedFeeCents, acceptedSellerCount } = parsed.data;

  try {
    const result = await checkoutCart(prisma, user.id, { county, address, acceptedFeeCents, acceptedSellerCount });
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
