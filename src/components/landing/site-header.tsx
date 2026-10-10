"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Menu, X, Search, ShoppingCart, ChevronRight, LayoutDashboard, MessageCircle,
  Store, Package, Heart, LifeBuoy, Mail, LogOut, UserRound, Star,
} from "lucide-react";
import { AccountMenu, type HeaderUser } from "@/components/landing/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { signOutAction } from "@/app/(auth)/actions";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-1.5 text-[22px] font-extrabold tracking-tight text-foreground">
      MALIHUB
      <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-primary">
        <Star className="h-2.5 w-2.5 fill-white text-white" />
      </span>
    </Link>
  );
}

function SearchBar({ className = "" }: { className?: string }) {
  return (
    <form action="/marketplace" role="search" className={className}>
      <label className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 lg:rounded-md">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          name="q"
          type="search"
          placeholder="Search products, brands and categories"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
    </form>
  );
}

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="container flex h-14 items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="-ml-1 p-1 lg:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Logo />

          <SearchBar className="mx-6 hidden flex-1 lg:block" />

          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <NotificationBell isSignedIn={!!user} />
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <Link href="/login" aria-label="Sign in" className="flex items-center gap-1.5 p-1.5 text-sm font-medium">
                <UserRound className="h-6 w-6" />
                <span className="hidden sm:inline">Sign in</span>
              </Link>
            )}
            <Link href="/buyer/cart" aria-label="Cart" className="flex items-center gap-1.5 p-1.5 text-sm font-medium">
              <ShoppingCart className="h-6 w-6" />
              <span className="hidden sm:inline">Cart</span>
            </Link>
          </div>
        </div>
        <div className="container pb-2.5 lg:hidden">
          <SearchBar />
        </div>
      </header>

      {/* Slide-in menu (mobile) */}
      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "visible" : "invisible"}`} aria-hidden={!open}>
        <div
          onClick={close}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <aside
          className={`absolute left-0 top-0 h-full w-[87%] max-w-sm overflow-y-auto bg-card transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex h-14 items-center gap-4 border-b border-border px-4">
            <button type="button" onClick={close} aria-label="Close menu"><X className="h-5 w-5" /></button>
            <Logo />
          </div>

          <MenuLink href="/support" label="NEED HELP?" heading chevron onClick={close} />
          <MenuLink href={user ? "/buyer" : "/login"} label="MY MALIHUB ACCOUNT" heading chevron onClick={close} />
          <MenuLink href="/buyer/orders" label="Orders" icon={Package} onClick={close} />
          <MenuLink href="/messages" label="Messages" icon={MessageCircle} onClick={close} />
          <MenuLink href="/buyer/wishlist" label="Wishlist" icon={Heart} onClick={close} />
          <MenuLink href="/buyer" label="Dashboard" icon={LayoutDashboard} onClick={close} />

          <div className="mt-1 flex items-center justify-between border-t border-border px-4 pb-1 pt-4 text-xs font-semibold text-muted-foreground">
            OUR CATEGORIES
            <Link href="/marketplace" onClick={close} className="font-normal text-primary">See All</Link>
          </div>
          {DEFAULT_CATEGORIES.map((c) => (
            <MenuLink key={c.slug} href={`/categories/${c.slug}`} label={c.name} onClick={close} />
          ))}

          <div className="mt-1 border-t border-border px-4 pb-1 pt-4 text-xs font-semibold text-muted-foreground">
            OUR SERVICES
          </div>
          <MenuLink
            href={user?.hasSellerProfile ? "/seller" : "/register?role=seller"}
            label={user?.hasSellerProfile ? "Seller dashboard" : "Sell on MaliHub"}
            icon={Store}
            onClick={close}
          />

          <div className="mt-1 border-t border-border">
            <MenuLink href="/support" label="Help Center" icon={LifeBuoy} onClick={close} />
            <MenuLink href="/contact" label="Contact us" icon={Mail} onClick={close} />
            {user && (
              <form action={signOutAction}>
                <button type="submit" className="flex w-full items-center gap-4 px-4 py-3 text-left text-sm text-destructive">
                  <LogOut className="h-5 w-5" /> Sign out
                </button>
              </form>
            )}
          </div>
          <div className="h-8" />
        </aside>
      </div>
    </>
  );
}

function MenuLink({
  href, label, icon: Icon, heading, chevron, onClick,
}: {
  href: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  heading?: boolean;
  chevron?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-4 px-4 py-3 active:bg-muted ${
        heading ? "border-b border-border text-xs font-semibold text-muted-foreground" : "text-sm"
      }`}
    >
      {Icon && <Icon className="h-5 w-5" />}
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight className="h-4 w-4" />}
    </Link>
  );
}
