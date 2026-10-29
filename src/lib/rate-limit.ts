import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/redis";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

/**
 * Each limiter is created lazily so a missing Redis config doesn't crash
 * the module graph — every exported check below handles `getRedis() ===
 * null` by allowing the request through (fail-open) with a console
 * warning. Deliberate availability trade-off: an Upstash outage degrades
 * to "no rate limiting" rather than "the whole app returns 500s".
 * Production deployments must have Redis configured for these
 * protections to actually apply — see README.
 */
function buildLimiter(prefix: string, limit: number, windowSeconds: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: `malihub:ratelimit:${prefix}`,
    analytics: true,
  });
}

const limiters = {
  // Brute-force login protection: keyed by email, tighter than IP-based
  // alone since a single attacker can rotate IPs but not target emails as
  // easily. 8 attempts / 5 minutes is generous for a real forgetful user,
  // tight for credential-stuffing.
  login: () => buildLimiter("login", 8, 300),
  signup: () => buildLimiter("signup", 5, 600),
  passwordReset: () => buildLimiter("password-reset", 5, 600),
  listingCreate: () => buildLimiter("listing-create", 10, 3600),\n  // Signed listing-image upload signatures are capped at 30 per rolling 24 hours per seller.\n  listingImageUpload: () => buildLimiter("listing-image-upload", 30, 86400),
  // Order-creation spam control: each creation reserves stock and writes
  // rows. 10 per 5 minutes per buyer is generous for a real checkout (a
  // multi-seller cart creates at most a handful at once) and bounds a
  // scripted buyer from churning orders.
  orderCreate: () => buildLimiter("order-create", 10, 300),
  // Payment initiation spam control: each initiation can create a provider
  // transaction. The per-order attempt cap in the payment services is the
  // hard, always-on bound; this per-buyer sliding window is the cross-order
  // bound (a buyer cycling many orders to hammer the provider). 10 per 5
  // minutes is generous for real checkout browsing, tight for scripting.
  paymentInitiate: () => buildLimiter("payment-initiate", 10, 300),
  // Payment-status verification (the checkout "waiting for payment" poll and
  // the manual "check status" action). Unlike the initiation limiter this
  // caps PROVIDER round-trips, not money-moving requests: a status check can
  // call Paystack's transaction-verify endpoint when an attempt is awaiting
  // confirmation. A buyer watching one payment polls every few seconds
  // (10/min at the checkout interval), so 30/min is generous for a human and
  // bounded for a script. A read-only lookup that does not verify is not
  // limited — it never leaves our database.
  paymentStatusCheck: () => buildLimiter("payment-status-check", 30, 60),
  // Webhook delivery bound, keyed by source address. The signature check is
  // the real protection; this only stops scan storms (unsigned POSTs from
  // many single-source addresses) from reaching the database layer. 120/min
  // per source is far above anything Paystack itself would send to one URL.
  webhook: () => buildLimiter("webhook", 120, 60),
  // Cart mutations (add / update quantity / remove), keyed by buyer. Every
  // method is a per-buyer database write and — unlike an order cancellation
  // — none of them is self-limiting, so a script could otherwise churn
  // writes indefinitely. Real checkout behaviour is chatty but bounded
  // (add a few items, tweak a quantity, drop one), so 60/min per user is
  // generous for a human and tight for a script.
  cartMutate: () => buildLimiter("cart-mutate", 60, 60),
  // Avatar uploads each perform a Cloudinary upload and a profile write.
  // 10/hour per user is far above re-tuning a photo, tight for storage
  // abuse (10 × 3MB/hour ≈ 30MB/hour of provider spend per account).
  avatarUpload: () => buildLimiter("avatar-upload", 10, 3600),
  // Chat WebSocket ticket (POST /api/chat/ws-ticket): one ticket = one
  // 60-second-lived socket with a server-resolved identity, so 20/minute
  // per user covers reconnects while bounding how many sockets an abusive
  // session can spin up (each socket also costs a per-join DB check).
  chatWsTicket: () => buildLimiter("chat-ws-ticket", 20, 60),
  api: () => buildLimiter("api", 120, 60),
} as const;

async function check(limiter: Ratelimit | null, key: string): Promise<RateLimitResult> {
  if (!limiter) {
    return { success: true, limit: Infinity, remaining: Infinity, reset: 0 };
  }
  return limiter.limit(key);
}

export const rateLimit = {
  login: (email: string) => check(limiters.login(), email.toLowerCase()),
  signup: (ip: string) => check(limiters.signup(), ip),
  passwordReset: (email: string) => check(limiters.passwordReset(), email.toLowerCase()),
  listingCreate: (sellerId: string) => check(limiters.listingCreate(), sellerId),\n  listingImageUpload: (sellerId: string) => check(limiters.listingImageUpload(), sellerId),
  orderCreate: (buyerId: string) => check(limiters.orderCreate(), buyerId),
  paymentInitiate: (buyerId: string) => check(limiters.paymentInitiate(), buyerId),
  paymentStatusCheck: (buyerId: string) => check(limiters.paymentStatusCheck(), buyerId),
  cartMutate: (buyerId: string) => check(limiters.cartMutate(), buyerId),
  avatarUpload: (userId: string) => check(limiters.avatarUpload(), userId),
  chatWsTicket: (userId: string) => check(limiters.chatWsTicket(), userId),
  webhook: (sourceIp: string) => check(limiters.webhook(), sourceIp),
  api: (userIdOrIp: string) => check(limiters.api(), userIdOrIp),
};

/** Friendly "try again in Xs/Xm" string from a reset timestamp. */
export function formatRetryAfter(resetMs: number): string {
  const seconds = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}
