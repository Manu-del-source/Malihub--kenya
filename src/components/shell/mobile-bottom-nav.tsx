"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, MessageCircle, ShoppingCart, UserRound } from "lucide-react";
import { activeMobileTab, buildMobileTabs, type MobileTabKey } from "@/lib/mobile-tabs";

const ICONS: Record<MobileTabKey, typeof Home> = {
  home: Home,
  categories: LayoutGrid,
  cart: ShoppingCart,
  messages: MessageCircle,
  account: UserRound,
};

/** Five buyer-focused tabs. Seller operations stay in the website Seller Centre. */
export function MobileBottomNav({ cartCount = 0 }: { cartCount?: number }) {
  const pathname = usePathname();
  const tabs = buildMobileTabs();
  const active = activeMobileTab(tabs, pathname);

  return (
    <nav
      aria-label="Buyer navigation"
      className="pwa-dashboard-bottom-nav fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map(({ key, label, href }) => {
          const Icon = ICONS[key];
          const isActive = active === key;
          const badge = key === "cart" && cartCount > 0 ? (cartCount > 99 ? "99+" : String(cartCount)) : null;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                aria-label={badge ? `${label}, ${badge} item${cartCount === 1 ? "" : "s"}` : label}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span
                  className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    isActive ? "bg-primary/20 text-primary-300" : "text-muted-foreground"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.2]" : "stroke-[1.7]"}`} aria-hidden />
                  {badge && (
                    <span className="absolute -right-0.5 -top-1 min-w-4 rounded-full bg-primary px-1 text-center font-mono text-[10px] font-bold leading-4 text-primary-foreground">
                      {badge}
                    </span>
                  )}
                </span>
                <span className={`truncate text-[11px] font-medium ${isActive ? "text-primary-300" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
