"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, MessageCircle, ShoppingCart, UserRound } from "lucide-react";

const ITEMS = [
  { label: "Home", href: "/", icon: Home, exact: true },
  { label: "Category", href: "/marketplace", icon: LayoutGrid, exact: false },
  { label: "Message", href: "/messages", icon: MessageCircle, exact: false },
  { label: "Cart", href: "/buyer/cart", icon: ShoppingCart, exact: false },
  { label: "Account", href: "/account", icon: UserRound, exact: false },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="pwa-dashboard-bottom-nav fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ label, href, icon: Icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={label}>
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  active ? "text-primary-300" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary"
                  />
                )}
                <Icon className={`h-5 w-5 ${active ? "stroke-[2.2]" : "stroke-[1.7]"}`} aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
