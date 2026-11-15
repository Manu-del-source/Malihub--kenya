"use client";

import { usePathname } from "next/navigation";
import { DashboardNavLinks } from "@/components/shell/dashboard-nav-links";

/**
 * Phone sub-navigation for the Seller area only. Everywhere else the phone UI
 * relies on the bottom bar, so account/buyer pages don't carry a second row of
 * a dozen scrolling pills. (The admin area has its own section nav.)
 */
export function MobileSellerNav({ items }: { items: { label: string; href: string }[] }) {
  const pathname = usePathname();
  if (!pathname.startsWith("/seller") || items.length === 0) return null;
  return (
    <div className="border-t border-border bg-card md:hidden">
      <nav className="pwa-dashboard-links flex gap-2 overflow-x-auto px-4 py-2.5" aria-label="Seller sections">
        <DashboardNavLinks items={items} mobile />
      </nav>
    </div>
  );
}
