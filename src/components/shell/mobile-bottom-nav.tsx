"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, MessageCircle, Package, UserRound } from "lucide-react";
import { activeMobileTab, buildMobileTabs, type MobileTabKey } from "@/lib/mobile-tabs";

const ICONS: Record<MobileTabKey, typeof Home> = {
  home: Home,
  categories: LayoutGrid,
  orders: Package,
  messages: MessageCircle,
  account: UserRound,
};

/**
 * Phone bottom bar: always five tabs. Seller Centre and Admin are reached from
 * the Account tab; Cart is in the header (see `buildMobileTabs`).
 */
export function MobileBottomNav({ hasSellerProfile }: { hasSellerProfile: boolean }) {
  const pathname = usePathname();
  const tabs = buildMobileTabs({ hasSellerProfile });
  const active = activeMobileTab(tabs, pathname);

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="pwa-dashboard-bottom-nav fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map(({ key, label, href }) => {
          const Icon = ICONS[key];
          const isActive = active === key;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  isActive ? "text-primary-300" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {isActive && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" />}
                <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.2]" : "stroke-[1.7]"}`} aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
