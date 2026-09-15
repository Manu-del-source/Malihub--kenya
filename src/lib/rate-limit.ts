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
  listingCreate: () => buildLimiter("listing-create", 10, 3600),
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
  listingCreate: (sellerId: string) => check(limiters.listingCreate(), sellerId),
  api: (userIdOrIp: string) => check(limiters.api(), userIdOrIp),
};

/** Friendly "try again in Xs/Xm" string from a reset timestamp. */
export function formatRetryAfter(resetMs: number): string {
  const seconds = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}
