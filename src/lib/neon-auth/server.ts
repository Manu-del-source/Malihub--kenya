import "server-only";
import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getNeonAuthPocConfig } from "@/lib/neon-auth/config";

/**
 * Server-side Neon Auth (Managed Better Auth) instance for the POC.
 *
 * This is the single seam between MaliHub and the Neon SDK. It is intentionally
 * *not* wired into `src/services/auth-service.ts`, Supabase, or any
 * provisioning path: the POC measures whether Neon Auth can stand on its own
 * before anything is migrated.
 *
 * The instance is created lazily (and cached per process) because:
 *  - `createNeonAuth()` validates the cookie secret eagerly and throws when the
 *    POC is not configured, and
 *  - the production Supabase flow must keep booting even when no Neon Auth
 *    variable is present.
 *
 * @see https://neon.com/docs/auth/reference/nextjs-server
 */
let cached: NeonAuth | null = null;

export function getNeonAuth(): NeonAuth {
  const config = getNeonAuthPocConfig();
  if (!config) {
    throw new Error(
      "Neon Auth POC is not configured. Set NEON_AUTH_BASE_URL (or NEON_AUTH_URL) " +
        "and NEON_AUTH_COOKIE_SECRET to enable /neon-auth-test."
    );
  }

  cached ??= createNeonAuth({
    baseUrl: config.baseUrl,
    cookies: { secret: config.cookieSecret },
    // The POC is chatty on purpose: `debug` makes proxy/upstream failures
    // visible while evaluating the integration. Production would use `warn`.
    logLevel: process.env.NODE_ENV === "production" ? "warn" : "debug",
  });

  return cached;
}
