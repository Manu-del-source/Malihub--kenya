import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];
const SELLER_PREFIX = "/dashboard/seller";
const BUYER_PREFIX = "/dashboard/buyer";
const ADMIN_PREFIX = "/dashboard/admin";

export async function middleware(request: NextRequest) {
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

  // Signed-in user hitting an auth route → send to their dashboard instead.
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL("/dashboard/buyer", request.url));
  }

  // Role gating for admin routes happens here at the edge; seller/buyer role
  // gating for finer-grained actions still happens in Server Actions/RLS,
  // since `user.role` here comes from a JWT claim that's cheap to check but
  // should never be the only line of defense.
  if (pathname.startsWith(ADMIN_PREFIX)) {
    const role = user?.app_metadata?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", request.url));
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
