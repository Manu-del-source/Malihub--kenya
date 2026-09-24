import { createNeonAuth } from "@neondatabase/auth/next/server";
import {
  getNeonAuthPocConfig,
  NEON_AUTH_POC_SIGN_IN_PATH,
} from "@/lib/neon-auth/config";

/**
 * Neon Auth middleware factory for the POC (Next.js 15 → `middleware.ts`; the
 * SDK docs call the same export `proxy` on Next.js 16).
 *
 * `auth.middleware()` validates the session cookie on the server (signed
 * session-data cookie first, upstream `/get-session` as fallback) and redirects
 * unauthenticated visitors to `loginUrl`. The root `src/middleware.ts` only
 * hands it requests for `NEON_AUTH_POC_PROTECTED_PATH`, so no production route
 * is ever passed through Neon Auth.
 *
 * This module is imported dynamically from the root middleware, which keeps the
 * Neon SDK (and `better-auth`/`jose`) out of the execution path of every
 * Supabase-authenticated request.
 */
type NeonAuthMiddleware = ReturnType<ReturnType<typeof createNeonAuth>["middleware"]>;

let cached: NeonAuthMiddleware | null = null;

export function getNeonAuthPocMiddleware(): NeonAuthMiddleware | null {
  const config = getNeonAuthPocConfig();
  if (!config) return null;

  cached ??= createNeonAuth({
    baseUrl: config.baseUrl,
    cookies: { secret: config.cookieSecret },
    logLevel: process.env.NODE_ENV === "production" ? "warn" : "debug",
  }).middleware({ loginUrl: NEON_AUTH_POC_SIGN_IN_PATH });

  return cached;
}
