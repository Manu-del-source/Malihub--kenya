import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  isNeonAuthPocEnabled,
  isNeonAuthPocPath,
  isNeonAuthProtectedPath,
  isNeonAuthProxyPath,
} from "@/lib/neon-auth/config";

const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];
const ONBOARDING_EXEMPT = ["/complete-profile", "/forgot-password", "/reset-password", "/verify-email", "/api"];
const SELLER_PREFIX = "/dashboard/seller";
const BUYER_PREFIX = "/dashboard/buyer";
const ADMIN_PREFIX = "/dashboard/admin";

/**
 * Neon Managed Better Auth proof of concept (docs/neon-auth-poc).
 *
 * Handles only `/neon-auth-test/*` and returns before the Supabase session
 * refresh below, so a POC request never touches Supabase (and a Supabase
 * request never touches Neon Auth). The SDK (`@/lib/neon-auth/middleware`) is
 * imported lazily so the production path carries none of its code.
 */
async function handleNeonAuthPocRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // 1. The SDK's own proxy route (sign-up/sign-in/sign-out/get-session).
  //    It must stay reachable while signed out — Neon Auth's middleware is
  //    never applied to it.
  if (isNeonAuthProxyPath(pathname)) {
    return NextResponse.next();
  }

  // 2. Public POC pages (the landing/sign-in pages must render while signed out
  //    so the POC can display its unauthenticated state).
  if (!isNeonAuthProtectedPath(pathname)) {
    return NextResponse.next();
  }

  // 3. The one protected POC route. Inert unless the POC is configured (and,
  //    in production, explicitly enabled) — otherwise the page itself reports
  //    that it is not configured.
  if (!isNeonAuthPocEnabled()) {
    return NextResponse.next();
  }

  const { getNeonAuthPocMiddleware } = await import("@/lib/neon-auth/middleware");
  const neonAuthMiddleware = getNeonAuthPocMiddleware();
  if (!neonAuthMiddleware) {
    return NextResponse.next();
  }

  return neonAuthMiddleware(request);
}

export async function middleware(request: NextRequest) {
  // POC routes short-circuit BEFORE updateSession() so Neon Auth can be
  // evaluated without Supabase credentials and without touching the
  // production session/refresh path.
  if (isNeonAuthPocPath(request.nextUrl.pathname)) {
    return handleNeonAuthPocRequest(request);
  }

  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
  const isProtectedRoute =
    pathname.startsWith(SELLER_PREFIX) ||
    pathname.startsWith(BUYER_PREFIX) ||
    pathname.startsWith(ADMIN_PREFIX);

  // Signed-out user hitting a protected route → send to login with a redirect-back target.
  if (isProtectedRoute && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Signed-in but hasn't finished onboarding yet → send them to finish it,
  // no matter where they were headed (dashboard OR back to login/register).
  // app_metadata is the edge-friendly cache; sign-in/profile completion
  // repair it from authoritative Neon state and refresh the JWT before a
  // dashboard redirect. Do not query Neon on every middleware invocation.
  // Takes priority over the auth-route bounce below.
  if (user && user.app_metadata?.onboarded !== true) {
    const isExempt = ONBOARDING_EXEMPT.some((route) => pathname.startsWith(route));
    if (!isExempt) {
      return NextResponse.redirect(new URL("/complete-profile", request.url));
    }
  }

  // Signed-in (and onboarded) user hitting an auth route → send to their dashboard instead.
  if (isAuthRoute && user && user.app_metadata?.onboarded === true) {
    return NextResponse.redirect(new URL("/dashboard/buyer", request.url));
  }

  // Role gating for admin routes happens here at the edge; seller/buyer role
  // gating for finer-grained actions still happens in Server Actions/RLS,
  // since `user.app_metadata` here comes from a JWT claim that's cheap to
  // check but should never be the only line of defense.
  if (pathname.startsWith(ADMIN_PREFIX)) {
    const role = user?.app_metadata?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Seller dashboard requires an actual Seller row (mirrored as
  // has_seller_profile in the JWT by completeUserProfile/becomeSellerAction)
  // — admins can also view it for support purposes.
  if (pathname.startsWith(SELLER_PREFIX)) {
    const role = user?.app_metadata?.role;
    const hasSellerProfile = user?.app_metadata?.has_seller_profile === true;
    if (!hasSellerProfile && role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard/buyer", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and image optimization files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
