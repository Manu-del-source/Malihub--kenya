/**
 * Neon Managed Better Auth — proof-of-concept configuration.
 *
 * This module is deliberately dependency-free (no SDK, no `server-only`, no
 * Next APIs) because the root `src/middleware.ts` imports it on the edge path
 * for *every* request. It only reads environment variables and matches the
 * POC's path prefixes; keeping it inert is what makes the POC safe to ship
 * next to the production Supabase flow.
 *
 * ─── Isolation contract ────────────────────────────────────────────────────
 * The POC is inert unless BOTH of these are true:
 *   1. a server-side Neon Auth URL + cookie secret are configured, and
 *   2. in production, `NEON_AUTH_POC_ENABLED=true` is explicitly set.
 * Nothing in here is read by the Supabase authentication path, and none of
 * these variables are exposed to the browser (`NEXT_PUBLIC_*` is not used —
 * the SDK's Next.js integration talks to its own proxy route instead, see
 * `src/app/neon-auth-test/api/auth/[...path]/route.ts`).
 *
 * See docs/neon-auth-poc/REPORT.md for the findings this POC produced.
 *
 * @see https://neon.com/docs/auth/quick-start/nextjs-api-only
 * @see https://neon.com/docs/auth/reference/nextjs-server
 */

/** Root of every POC route. Nothing outside this prefix is touched. */
export const NEON_AUTH_POC_BASE_PATH = "/neon-auth-test";

/**
 * Where the Managed Better Auth proxy is mounted.
 *
 * The SDK's Next.js client (`createAuthClient()`) assumes `/api/auth/[...path]`,
 * which MaliHub already uses for its Supabase OAuth callback
 * (`src/app/api/auth/callback/route.ts`). The POC therefore mounts its own
 * catch-all under the POC prefix instead, and the middleware below explicitly
 * never treats it as a protected route.
 */
export const NEON_AUTH_POC_PROXY_PATH = `${NEON_AUTH_POC_BASE_PATH}/api/auth`;

/** The login URL handed to `auth.middleware({ loginUrl })`. */
export const NEON_AUTH_POC_SIGN_IN_PATH = `${NEON_AUTH_POC_BASE_PATH}/sign-in`;

/** The only route in this repository guarded by Neon Auth's middleware. */
export const NEON_AUTH_POC_PROTECTED_PATH = `${NEON_AUTH_POC_BASE_PATH}/protected`;

export type NeonAuthPocConfig = {
  /** Neon Auth base URL from the Neon Console (Auth → Configuration). */
  baseUrl: string;
  /** HS256 secret for the SDK's signed session-data cookie (32+ chars). */
  cookieSecret: string;
};

type Env = Record<string, string | undefined>;

function trimmed(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate ? candidate : null;
}

/**
 * Resolves the Neon Auth base URL.
 *
 * `NEON_AUTH_BASE_URL` is the name the current official Next.js SDK documents.
 * `NEON_AUTH_URL` is accepted as an alias so an existing Neon Console value
 * keeps working without a rename. Both are server-side only.
 */
export function resolveNeonAuthBaseUrl(env: Env = process.env): string | null {
  return trimmed(env.NEON_AUTH_BASE_URL) ?? trimmed(env.NEON_AUTH_URL);
}

/**
 * Resolves the cookie-signing secret. The SDK rejects anything shorter than 32
 * characters, and this module surfaces the same requirement instead of
 * silently generating a throwaway secret (a rotating secret would invalidate
 * sessions on every deploy).
 */
export function resolveNeonAuthCookieSecret(env: Env = process.env): string | null {
  return trimmed(env.NEON_AUTH_COOKIE_SECRET);
}

export function getNeonAuthPocConfig(env: Env = process.env): NeonAuthPocConfig | null {
  const baseUrl = resolveNeonAuthBaseUrl(env);
  const cookieSecret = resolveNeonAuthCookieSecret(env);
  if (!baseUrl || !cookieSecret) return null;
  return { baseUrl, cookieSecret };
}

/**
 * Whether the POC is allowed to run at all.
 *
 * In production the POC stays dark unless `NEON_AUTH_POC_ENABLED=true`, so
 * merging this branch (or deploying it) cannot expose a second authentication
 * surface on the live domain. It also requires real configuration — a
 * half-configured POC renders an explanatory panel rather than crashing.
 */
export function isNeonAuthPocEnabled(env: Env = process.env): boolean {
  if (env.NODE_ENV === "production" && env.NEON_AUTH_POC_ENABLED !== "true") {
    return false;
  }
  return getNeonAuthPocConfig(env) !== null;
}

/** True for every route owned by the POC. */
export function isNeonAuthPocPath(pathname: string): boolean {
  return pathname === NEON_AUTH_POC_BASE_PATH || pathname.startsWith(`${NEON_AUTH_POC_BASE_PATH}/`);
}

/** True for the SDK's proxy mount (sign-up/sign-in/sign-out/get-session …). */
export function isNeonAuthProxyPath(pathname: string): boolean {
  return pathname === NEON_AUTH_POC_PROXY_PATH || pathname.startsWith(`${NEON_AUTH_POC_PROXY_PATH}/`);
}

/** True for the single route Neon Auth's middleware is asked to protect. */
export function isNeonAuthProtectedPath(pathname: string): boolean {
  return pathname === NEON_AUTH_POC_PROTECTED_PATH || pathname.startsWith(`${NEON_AUTH_POC_PROTECTED_PATH}/`);
}
