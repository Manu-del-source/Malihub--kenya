import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { handlePaystackWebhook } from "@/services/payment-webhook-service";

/**
 * `POST /api/payments/paystack/webhook` — Paystack's server-to-server event
 * delivery (the settlement channel).
 *
 * ─── Why no session and no CSRF check ──────────────────────────────────────
 * This endpoint is called by Paystack's servers, not by a browser: there is
 * no session cookie to protect and no Origin header to compare, so
 * `verifySameOrigin` does not apply and is deliberately absent. The endpoint
 * is public for the same reason a bank's card-acquirer settlement endpoint is
 * public, and it is secured by exactly the layered validation in
 * `payment-webhook-service.ts`:
 *
 *   1. `x-paystack-signature` verified as the hex-encoded HMAC-SHA512 of the
 *      EXACT raw request body keyed with `PAYSTACK_SECRET_KEY` — Paystack's
 *      documented signing scheme (constant-time comparison, raw bytes, no
 *      re-serialization). An unverifiable delivery gets 401 and writes
 *      nothing.
 *   2. The reference must resolve to a payment row WE created before
 *      contacting the provider.
 *   3. Exact integer amount and currency match against that row.
 *   4. Re-verification against Paystack's own authenticated API before any
 *      claim runs.
 *   5. Conditional database claims + `(provider, providerEventId)` dedup.
 *
 * A forged delivery cannot clear gates 1–4, and even if it could, gate 5
 * means it still cannot move money.
 *
 * ─── Configuration ─────────────────────────────────────────────────────────
 * Point Paystack at this URL in Dashboard → Settings → API Keys & Webhooks
 * (test and live modes are configured separately, and the secret key used for
 * signatures is the same key this deployment uses for API calls).
 *
 * ─── Response contract (Paystack expects a fast 200) ───────────────────────
 *  - 200 for every well-formed delivery, including duplicates, unknown
 *    references, mismatches and verification failures: the event row already
 *    records what we need, the claims are conditional, and a non-200 would
 *    only invite provider retries for things that can never change.
 *  - 401 only when the signature did not verify (or the provider is not
 *    configured — we fail closed rather than process unverifiable bytes).
 *  - 400 only when the body is not the documented envelope at all.
 *  - 429 when the per-source delivery rate is absurd (scan/abuse bound).
 *  - 500 only when OUR OWN write path failed — the one case where a provider
 *    retry genuinely helps, since nothing committed.
 *
 * The body never echoes payment ids, order numbers or lifecycle detail:
 * Paystack (and anyone else watching) learns nothing beyond "received".
 */
export async function POST(request: NextRequest) {
  // Delivery-rate bound, keyed by source address. Fail-open when Redis is not
  // configured (module policy) — the signature gate above is the real
  // protection; this only stops scan storms from reaching the database.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const limit = await rateLimit.webhook(ip);
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: `Too many webhook deliveries. Try again ${formatRetryAfter(limit.reset)}.` },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) },
      }
    );
  }

  // The signature is computed over the EXACT bytes on the wire. Read the raw
  // text first; parsing to JSON later is safe because verification happens
  // before any parse and over these original bytes.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ success: false, error: "Unreadable body." }, { status: 400 });
  }

  try {
    const outcome = await handlePaystackWebhook(prisma, {
      rawBody,
      signature: request.headers.get("x-paystack-signature"),
    });

    if (outcome.kind === "invalid_signature") {
      return NextResponse.json({ success: false, error: "Invalid signature." }, { status: 401 });
    }
    if (outcome.kind === "invalid_payload") {
      return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: { received: true } }, { status: 200 });
  } catch (error) {
    console.error("POST /api/payments/paystack/webhook failed", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong." },
      { status: 500 }
    );
  }
}
