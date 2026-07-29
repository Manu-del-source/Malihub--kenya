import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? await prisma.profile.findUnique({
        where: { userId: user.id },
        select: { fullName: true, avatarUrl: true },
      })
    : null;

  const headerUser = user
    ? {
        email: user.email ?? "",
        fullName: profile?.fullName || null,
        avatarUrl: profile?.avatarUrl || null,
        hasSellerProfile: user.app_metadata?.has_seller_profile === true,
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
