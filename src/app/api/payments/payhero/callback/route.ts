import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handlePayheroCallback } from "@/services/payment-callback-service";

/**
 * `POST /api/payments/payhero/callback` — PayHero's server-to-server STK
 * result callback.
 *
 * ─── Why no CSRF check and no session ──────────────────────────────────────
 * This endpoint is called by PayHero's servers, not by a browser: there is no
 * session cookie to protect and no Origin header to compare, so
 * `verifySameOrigin` (which guards our browser-facing mutations against
 * cross-site form posts) does not apply and is deliberately absent. The
 * endpoint's security is the payment-specific validation in
 * `payment-callback-service.ts`: documentation-exact payload shape, a
 * reference that must resolve to a payment row WE created before any provider
 * call, an exact amount match against that row, conditional database claims,
 * and (provider, providerEventId) deduplication at the schema level. A forged
 * callback that does not clear every one of those gates is recorded and
 * ignored — it cannot move money.
 *
 * ─── Response contract ─────────────────────────────────────────────────────
 *  - 200 for every well-formed delivery, including duplicates, unknown
 *    references and anomalies: the outcome is fully recorded, and a 4xx would
 *    only invite retries that cannot change anything.
 *  - 400 only when the payload is not the documented shape at all.
 *  - 500 only when OUR OWN write path failed — the one case where a provider
 *    retry genuinely helps, since nothing committed.
 *
 * The body never echoes payment ids, order numbers or lifecycle detail: PayHero
 * (and anyone else watching) learns nothing from this endpoint beyond "the
 * bytes parsed".
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  try {
    const outcome = await handlePayheroCallback(prisma, body);

    if (outcome.kind === "invalid_payload") {
      return NextResponse.json(
        { success: false, error: "Invalid payload." },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: { received: true } }, { status: 200 });
  } catch (error) {
    console.error("POST /api/payments/payhero/callback failed", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong." },
      { status: 500 }
    );
  }
}
