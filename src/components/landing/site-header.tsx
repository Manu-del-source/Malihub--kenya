"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Menu, X, Moon, Sun, ArrowUpRight, Search, ShoppingCart, ChevronRight,
  Package, MessageCircle, Heart, LayoutDashboard, Store, LifeBuoy, Mail, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { useTheme } from "@/providers/theme-provider";
import { AccountMenu, type HeaderUser } from "@/components/landing/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { signOutAction } from "@/app/(auth)/actions";

const NAV_LINKS = [
  { label: "Explore", href: "/marketplace" },
  { label: "Categories", href: "/#categories" },
  { label: "How it works", href: "/#why-malihub" },
  { label: "Sell on MaliHub", href: "/#sell" },
];

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <Container className="pt-4">
        <div className="glass flex items-center gap-2 rounded-full px-3 py-2.5 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link href="/" className="flex items-center gap-2 font-display text-lg font-medium">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground"
            >
              M
            </span>
            <span className="hidden min-[380px]:inline">MaliHub</span>
          </Link>

          {/* Desktop: marketplace-style search sits in the header */}
          <form action="/marketplace" role="search" className="mx-4 hidden flex-1 lg:block">
            <label className="flex items-center gap-2 rounded-full border border-border bg-muted/60 px-4 py-2 transition-colors focus-within:border-primary/50">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                name="q"
                type="search"
                placeholder="Search products, brands and categories"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          </form>

          <nav className="hidden items-center gap-6 xl:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2 lg:ml-0">
            <Link
              href="/marketplace"
              aria-label="Search"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <Search className="h-[18px] w-[18px]" />
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="hidden h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <NotificationBell isSignedIn={!!user} />

            <Link
              href="/buyer/cart"
              aria-label="Cart"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
            </Link>

            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button variant="primary" size="sm" asChild className="hidden sm:inline-flex">
                  <Link href="/register">
                    Start selling
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </Container>

      {/* Slide-in category menu (below lg) */}
      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "visible" : "invisible"}`} aria-hidden={!open}>
        <div
          onClick={close}
          className={`absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <aside
          className={`absolute left-0 top-0 flex h-full w-[86%] max-w-sm flex-col overflow-y-auto border-r border-border bg-background shadow-glass transition-transform duration-300 ease-premium ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="flex items-center gap-2 font-display text-lg font-medium">
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground">M</span>
              MaliHub
            </span>
            <button type="button" onClick={close} aria-label="Close menu" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form action="/marketplace" role="search" className="px-4 pt-4">
            <label className="flex items-center gap-2 rounded-full border border-border bg-muted/60 px-4 py-2.5">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
              <input name="q" type="search" placeholder="Search MaliHub" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </label>
          </form>

          <Section title="My account" />
          <Row href={user ? "/buyer" : "/login"} label={user ? "Dashboard" : "Sign in"} icon={LayoutDashboard} onClick={close} />
          <Row href="/buyer/orders" label="Orders" icon={Package} onClick={close} />
          <Row href="/messages" label="Messages" icon={MessageCircle} onClick={close} />
          <Row href="/buyer/wishlist" label="Wishlist" icon={Heart} onClick={close} />

          <Section title="Categories" action={{ label: "See all", href: "/marketplace" }} onClick={close} />
          {DEFAULT_CATEGORIES.map((c) => (
            <Row key={c.slug} href={`/categories/${c.slug}`} label={c.name} chevron onClick={close} />
          ))}

          <Section title="Sell" />
          <Row
            href={user?.hasSellerProfile ? "/seller" : "/register?role=seller"}
            label={user?.hasSellerProfile ? "Seller dashboard" : "Sell on MaliHub"}
            icon={Store}
            onClick={close}
          />

          <Section title="Support" />
          <Row href="/support" label="Help center" icon={LifeBuoy} onClick={close} />
          <Row href="/contact" label="Contact us" icon={Mail} onClick={close} />

          <div className="mt-auto flex items-center gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-border text-sm text-muted-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            {user && (
              <form action={signOutAction} className="flex-1">
                <button type="submit" className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-sm text-destructive">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </form>
            )}
          </div>
        </aside>
      </div>
    </header>
  );
}

function Section({ title, action, onClick }: { title: string; action?: { label: string; href: string }; onClick?: () => void }) {
  return (
    <div className="mt-2 flex items-center justify-between px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
      {action && (
        <Link href={action.href} onClick={onClick} className="font-medium normal-case tracking-normal text-primary">
          {action.label}
        </Link>
      )}
    </div>
  );
}

function Row({ href, label, icon: Icon, chevron, onClick }: {
  href: string; label: string; icon?: React.ComponentType<{ className?: string }>; chevron?: boolean; onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/90 transition-colors hover:bg-muted active:bg-muted">
      {Icon && <Icon className="h-[18px] w-[18px] text-muted-foreground" />}
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </Link>
  );
}
