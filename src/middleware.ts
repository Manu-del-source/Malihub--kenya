import { type NextRequest, NextResponse } from "next/server";
import {
  isAuthReturnRequest,
  isProtectedPath,
  LOGIN_PATH,
  pathWithoutVerifierParam,
} from "@/lib/auth/config";
import { createNeonAuthMiddleware } from "@/lib/auth/neon";
import { loginUrlWithRedirect } from "@/lib/auth/redirects";

/**
 * MaliHub edge middleware.
 *
 * ─── One authentication path ───────────────────────────────────────────────
 * Neon Auth (Managed Better Auth) is the only thing that authenticates a
 * request here. The previous provider's `updateSession()` is no longer called
 * from this file, and the isolated proof-of-concept branch that used to
 * short-circuit ahead of it is gone. There is no second path and no feature
 * flag selecting between two paths.
 *
 * ─── What middleware does, and what it deliberately does NOT do ────────────
 * It answers exactly one question: **is there a valid Neon Auth session?**
 *
 * It does not decide what that session may access. Role, onboarding state and
 * seller access are MaliHub application state living in Postgres, and they are
 * enforced server-side by the guards in `src/lib/auth/session.ts`
 * (`requireAdministrator()`, `requireSellerAccess()`, `requireOnboardedUser()`).
 *
 * Three reasons, all of which the previous implementation ran into:
 *  1. Neon Auth exposes no `app_metadata` equivalent and accepts no custom
 *     Better Auth plugins, so there is no claim to read even if we wanted one.
 *  2. Reading application tables here would put a database round trip on every
 *     request, including the landing page and every product page.
 *  3. Claim caches go stale. The redirect-loop bugs this repository already
 *     fixed twice were caused by middleware trusting a JWT claim that lagged
 *     behind the database. Authoritative state read at the point of use has no
 *     such lag.
 *
 * Public routes are never handed to the auth service at all, so an anonymous
 * visitor browsing the marketplace costs MaliHub no session validation and no
 * database query.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  /**
   * A request returning from Google OAuth or from an emailed verification /
   * reset link. The auth service sends the browser back to `callbackURL` with a
   * one-time `neon_auth_session_verifier` parameter, and the SDK's middleware
   * exchanges it for real session cookies on OUR origin — that exchange is the
   * only way the browser ends up holding a MaliHub-scoped session after a
   * redirect-based flow, so it must be allowed to run even on a path that is
   * not itself protected (e.g. `/complete-profile`).
   */
  const isAuthReturn = isAuthReturnRequest(request.nextUrl);
  const isProtected = isProtectedPath(pathname);

  if (!isProtected && !isAuthReturn) {
    return NextResponse.next();
  }

  // The visitor's real destination, with the one-time verifier stripped so it
  // can never be persisted into a `redirectTo`, a log line, or a bookmark.
  const target = pathWithoutVerifierParam(request.nextUrl);
  const loginUrl = loginUrlWithRedirect(LOGIN_PATH, target);

  const neonAuthMiddleware = createNeonAuthMiddleware(loginUrl);

  /**
   * FAIL CLOSED. If Neon Auth is not configured there is no way to establish
   * anybody's identity, so a protected route must not be served. Sending the
   * visitor to the sign-in page (rather than throwing) keeps the failure
   * legible: `/login` renders and the auth actions report the misconfiguration,
   * instead of every dashboard URL returning an opaque edge-runtime 500.
   *
   * An auth-return request is allowed through when unconfigured — there is
   * nothing to exchange and the landing page will simply show a signed-out
   * state, which is more useful than a redirect loop.
   */
  if (!neonAuthMiddleware) {
    console.error(
      "[auth] Neon Auth is not configured; refusing protected route. " +
        "Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET.",
      { protected: isProtected }
    );
    if (!isProtected) return NextResponse.next();
    return NextResponse.redirect(new URL(loginUrl, request.url));
  }

  try {
    // The SDK validates the signed `session_data` cookie locally with no
    // network call, performs the OAuth verifier exchange when needed, and
    // redirects to `loginUrl` when there is no session. It also fails closed on
    // its own: an unreachable auth service produces a redirect, never a pass.
    return (await neonAuthMiddleware(request)) as NextResponse;
  } catch (error) {
    // Unexpected SDK failure. Same rule as above: a protected route is never
    // served just because authentication could not be evaluated.
    console.error("[auth] session validation failed; failing closed", {
      protected: isProtected,
      error: error instanceof Error ? error.name : typeof error,
    });
    if (!isProtected) return NextResponse.next();
    return NextResponse.redirect(new URL(loginUrl, request.url));
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and image optimization files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
