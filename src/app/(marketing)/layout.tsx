import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Rendered per request — never prerendered.
 *
 * This route reads the current session, and a session is per-request state. The
 * declaration is explicit rather than incidental on purpose: the previous
 * implementation got it for free because constructing a Supabase client called
 * `cookies()`, which Next.js treats as an opt into dynamic rendering. Reading a
 * Neon Auth session does not always do that — when the auth environment is not
 * configured the read short-circuits before touching a cookie — so a build run
 * without those variables would happily prerender this page as a static redirect
 * to /login and ship it that way, signing every visitor out.
 *
 * This is also what the Neon Auth Next.js documentation requires of any Server
 * Component that reads a session. See docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Marketing pages are public, so this is a lookup rather than a guard: an
  // unauthenticated visitor simply gets the signed-out header.
  const current = await getCurrentUser();
  const user = current?.user;

  const profile = user
    ? await prisma.profile.findUnique({
        where: { userId: user.id },
        select: { fullName: true, avatarUrl: true },
      })
    : null;

  const headerUser = user
    ? {
        email: user.email,
        fullName: profile?.fullName || null,
        // Falls back to the auth-provider photo when no avatar has been
        // uploaded — the identity carries `user.image` (e.g. a Google profile
        // photo) where the previous provider kept it in `user_metadata`.
        avatarUrl: profile?.avatarUrl || current?.identity.image || null,
        hasSellerProfile: user.hasSellerProfile,
      }
    : null;

  return (
    <>
      <SiteHeader user={headerUser} />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
