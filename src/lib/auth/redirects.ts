/**
 * Safe-redirect validation, shared by the middleware and the auth Server
 * Actions.
 *
 * This is the same rule MaliHub already enforced inside
 * `src/app/(auth)/actions.ts`; it lives here so the edge and the server can
 * never drift apart on what counts as a safe destination. A `redirectTo` that
 * fails validation is discarded and replaced by the caller's default — it is
 * never partially honoured.
 *
 * Pure and dependency-free: safe to import from middleware.
 */

/** Origin used only as a parsing base; never appears in a result. */
const PARSE_BASE = "https://malihub.internal";

/**
 * Accepts only same-origin path redirects.
 *
 * In particular, protocol-relative (`//evil.example`) and backslash-normalised
 * (`/\evil.example`) URLs must NOT be accepted merely because their first
 * character is a slash — both are resolved as absolute URLs by browsers.
 *
 * @returns a normalized `pathname + search + hash`, or `null` when the target
 *          is absent or unsafe.
 */
export function safeInternalRedirect(redirectTo: string | null | undefined): string | null {
  if (!redirectTo) return null;
  if (!redirectTo.startsWith("/")) return null;
  if (redirectTo.startsWith("//")) return null;
  if (redirectTo.includes("\\")) return null;

  try {
    const base = new URL(PARSE_BASE);
    const destination = new URL(redirectTo, base);
    if (destination.origin !== base.origin) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

/**
 * Builds the login URL the middleware redirects to, carrying the visitor's
 * original destination so they land back where they were headed after signing
 * in.
 *
 * The target is passed through {@link safeInternalRedirect} first, so a crafted
 * request path can never smuggle an external origin into the redirect chain.
 */
export function loginUrlWithRedirect(
  loginPath: string,
  originalPath: string,
  paramName = "redirectTo"
): string {
  const safe = safeInternalRedirect(originalPath);
  if (!safe) return loginPath;

  const url = new URL(loginPath, PARSE_BASE);
  url.searchParams.set(paramName, safe);
  return `${url.pathname}${url.search}`;
}
