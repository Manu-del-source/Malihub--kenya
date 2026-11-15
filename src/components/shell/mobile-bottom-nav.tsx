"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, MessageCircle, Package, ShieldCheck, ShoppingCart, Store, UserRound } from "lucide-react";

const ITEMS = [
  { label: "Home", href: "/", icon: Home, exact: true },
  { label: "Category", href: "/marketplace", icon: LayoutGrid, exact: false },
  { label: "Message", href: "/messages", icon: MessageCircle, exact: false },
  { label: "Cart", href: "/buyer/cart", icon: ShoppingCart, exact: false },
  { label: "Account", href: "/account", icon: UserRound, exact: false },
] as const;

export function MobileBottomNav({ sellerDashboardHref, ordersHref, adminDashboardHref }: { sellerDashboardHref?: string; ordersHref?: string; adminDashboardHref?: string }) {
  const pathname = usePathname();
  const base = [
    ...ITEMS.slice(0, 2),
    ...(sellerDashboardHref
      ? [{ label: "Seller", href: sellerDashboardHref, icon: Store, exact: false }]
      : []),
    ...(ordersHref
      ? [{ label: "Orders", href: ordersHref, icon: Package, exact: false }]
      : []),
    ...(adminDashboardHref
      ? [{ label: "Admin", href: adminDashboardHref, icon: ShieldCheck, exact: false }]
      : []),
    ...ITEMS.slice(2),
  ];
  // A seller who is also an admin would otherwise get 8 cramped tabs. Category
  // is the least-critical tab here (the marketplace is one tap from Home).
  const items = base.length > 7 ? base.filter((item) => item.label !== "Category") : base;

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="pwa-dashboard-bottom-nav fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl md:hidden"
    >
      <ul className={`mx-auto grid max-w-xl ${items.length >= 7 ? "grid-cols-7" : items.length === 6 ? "grid-cols-6" : "grid-cols-5"}`}>
        {items.map(({ label, href, icon: Icon, exact }) => {
          const onOrders = !!ordersHref && (pathname === ordersHref || pathname.startsWith(`${ordersHref}/`));
          const active = exact
            ? pathname === href
            : label === "Seller" && onOrders
              ? false
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
