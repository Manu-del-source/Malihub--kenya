"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Package, ShoppingCart, MessageCircle, Store, ShieldCheck,
  Menu, X, Moon, Sun, LogOut, UserRound, Heart, Wallet, Search,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { signOutAction } from "@/app/(auth)/actions";

export type NavItem = { label: string; href: string };
export type BottomItem = { label: string; href: string; icon: IconName };

type IconName =
  | "dashboard" | "products" | "orders" | "cart" | "messages" | "shop"
  | "admin" | "account" | "wishlist" | "sales";

const ICONS: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  products: Package,
  orders: Package,
  cart: ShoppingCart,
  messages: MessageCircle,
  shop: Store,
  admin: ShieldCheck,
  account: UserRound,
  wishlist: Heart,
  sales: Wallet,
};

// Roots that must only be "active" on an exact match, otherwise they would
// light up for every page beneath them.
const EXACT = new Set(["/seller", "/buyer", "/admin"]);

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    EXACT.has(href) ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop top navigation with the current page highlighted. */
export function DesktopNav({ primary, shared }: { primary: NavItem[]; shared: NavItem[] }) {
  const isActive = useIsActive();
  const link = (item: NavItem) => (
    <Link
      key={`${item.label}-${item.href}`}
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={`relative whitespace-nowrap py-1 transition-colors hover:text-foreground ${
        isActive(item.href)
          ? "font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-[21px] after:h-0.5 after:rounded-full after:bg-primary"
          : ""
      }`}
    >
      {item.label}
    </Link>
  );
  return (
    <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex" aria-label="Dashboard">
      {primary.map(link)}
      <span aria-hidden className="h-4 w-px bg-border" />
      {shared.map(link)}
    </nav>
  );
}

/** Mobile bottom tab bar + a "More" sheet holding every other link. */
export function BottomNav({
  tabs,
  all,
}: {
  tabs: BottomItem[];
  all: NavItem[];
}) {
  const isActive = useIsActive();
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <nav
        aria-label="Dashboard (mobile)"
        className="sticky bottom-0 z-40 grid h-16 grid-cols-5 border-t border-border bg-background/95 backdrop-blur-md md:hidden"
      >
        {tabs.map(({ label, href, icon }) => {
          const Icon = ICONS[icon];
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="More"
          aria-expanded={open}
          className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
        >
          <Menu className="h-5 w-5" aria-hidden />
          More
        </button>
      </nav>

      <div className={`fixed inset-0 z-50 md:hidden ${open ? "visible" : "invisible"}`} aria-hidden={!open}>
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <div
          className={`absolute inset-x-0 bottom-0 max-h-[85svh] overflow-y-auto rounded-t-2xl border-t border-border bg-background pb-6 transition-transform duration-300 ease-premium ${open ? "translate-y-0" : "translate-y-full"}`}
        >
          <div className="flex items-center justify-between px-4 py-4">
            <p className="font-display text-lg font-medium">Menu</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4">
            {all.map((item) => (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                  isActive(item.href) ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-4 flex gap-2 px-4">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border text-sm text-muted-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <form action={signOutAction} className="flex-1">
              <button type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm text-destructive">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

/** Small round icon button used in the dashboard header. */
export function HeaderSearchLink() {
  return (
    <Link
      href="/marketplace"
      aria-label="Search the marketplace"
      className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Search className="h-[18px] w-[18px]" />
    </Link>
  );
}
