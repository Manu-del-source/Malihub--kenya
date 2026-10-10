import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { getHeaderUser } from "@/lib/header-user";

/**
 * Per-request: the header reads the session (see the banner in
 * src/app/(marketing)/layout.tsx for why this must not be prerendered).
 */
export const dynamic = "force-dynamic";

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const headerUser = await getHeaderUser();

  return (
    <>
      <SiteHeader user={headerUser} />
      {/* The header is fixed, so reserve its height. */}
      <main className="min-h-[70vh] pt-20">{children}</main>
      <SiteFooter />
    </>
  );
}
