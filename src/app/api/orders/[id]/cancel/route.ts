import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { cancelOrder, OrderTransitionError, type OrderTransitionErrorCode } from "@/services/order-transition-service";

/**
 * `POST /api/orders/[id]/cancel` — the buyer cancels their own unpaid order.
 *
 * ─── What this route deliberately does not accept ────────────────────────────
 * The request body is read for nothing. It carries no user id, no role, no
 * seller id and no status — there is no field here that could change who the
 * caller is or what the order becomes. Both are derived server-side: the actor
 * from the session via `getCurrentUser()`, the target status from the state
 * machine inside the service.
 *
 * The `id` in the path is a UUID validated by zod before it reaches Prisma, so
 * a malformed value is a 400 rather than a database error.
 *
 * ─── Error mapping, and why `not_found` covers two cases ─────────────────────
 * `cancelOrder` returns `not_found` both for an order that does not exist and
 * for one that belongs to someone else. That is intentional: answering "403 —
 * not yours" separately from "404 — no such order" would turn this endpoint
 * into an oracle for discovering other buyers' order ids. Both cases are
 * reported identically, exactly as `getBuyerOrder` already behaves.
 *
 * A state conflict on the caller's *own* order is a 409, which reveals nothing
 * they could not already see on their own order page.
 *
 * ─── No rate limiting ───────────────────────────────────────────────────────
 * `rateLimit` exists in `src/lib/rate-limit.ts` but is not applied to any
 * route in the repository today, including `POST /api/orders` and every method
 * on `/api/cart`. Adding it here alone would be a new convention rather than
 * following one, so this route matches its sibling. Cancellation is already
 * self-limiting: a second call on a cancelled order is a 409 that writes
 * nothing.
 */

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Service error code → HTTP status.
 *
 * Typed as a total `Record` over `OrderTransitionErrorCode` rather than a
 * ternary chain so that a new refusal reason cannot be added to the service
 * without this route deciding what it means over the wire. TypeScript then
 * fails the build on the omission.
 *
 *   - `not_found` 404 — deliberately shared with "exists but isn't yours", so
 *     this endpoint can't be used to discover other buyers' order ids.
 *   - `already_cancelled` / `invalid_transition` / `amount_mismatch` all 409 —
 *     the caller's own order is in a state that forbids this move. This is the
 *     "stale state" answer: a rival transaction already won the race.
 */
const CANCEL_ERROR_STATUS: Record<OrderTransitionErrorCode, number> = {
  not_found: 404,
  already_cancelled: 409,
  invalid_transition: 409,
  amount_mismatch: 409,
};

export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
  }

  try {
    const result = await cancelOrder(prisma, { actorUserId: user.id, orderId: id });


    return NextResponse.json({
      success: true,
      data: {
        order: result.order,
        previousStatus: result.previousStatus,
        restoredUnits: result.restoredUnits,
      },
    });
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: CANCEL_ERROR_STATUS[error.code] }
      );
    }

    // Anything unexpected (a Prisma error, a lost connection) is logged
    // server-side and reported as a generic 500. The client never sees a
    // database message, a stack, or a query.
    console.error("POST /api/orders/[id]/cancel failed", error);
    return NextResponse.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}
