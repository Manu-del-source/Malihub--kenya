"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Menu, X } from "lucide-react";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { AccountMenu, type HeaderUser } from "@/components/landing/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { signOutAction } from "@/app/(auth)/actions";

const NAV_LINKS = [
  { label: "Explore", href: "/marketplace" },
  { label: "Suppliers", href: "/become-a-supplier" },
  { label: "Contact", href: "/contact" },
];

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <Container className="pt-3 sm:pt-4">
        <div className="site-header-surface flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 sm:rounded-full sm:px-5">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="MaliHub home">
            <Image src="/icons/logo.svg" alt="" aria-hidden width={36} height={36} priority className="rounded-xl transition-transform group-hover:rotate-[-5deg]" />
            <span className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              Mali<span className="text-primary-400">Hub</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-4 xl:flex" aria-label="Primary navigation">
            <div className="relative">
              <button
                type="button"
                onClick={() => setCategoriesOpen((value) => !value)}
                onKeyDown={(event) => { if (event.key === "Escape") setCategoriesOpen(false); }}
                aria-expanded={categoriesOpen}
                aria-controls="desktop-category-menu"
                className="nav-link inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-primary-400"
              >
                Shop by category
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${categoriesOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {categoriesOpen && (
                <>
                  <button type="button" aria-label="Close category menu" onClick={() => setCategoriesOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <section id="desktop-category-menu" aria-label="Browse MaliHub categories" className="absolute left-1/2 top-[calc(100%+22px)] z-50 w-[min(92vw,960px)] -translate-x-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
                    <div className="mb-5 flex items-end justify-between gap-4 border-b border-border pb-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">The MaliHub catalogue</p>
                        <h2 className="mt-1 font-display text-xl font-semibold">Find your next good find</h2>
                      </div>
                      <Link href="/marketplace" onClick={() => setCategoriesOpen(false)} className="shrink-0 text-sm font-medium text-primary hover:underline">Explore everything →</Link>
                    </div>
                    <div className="grid grid-cols-4 gap-x-6 gap-y-1">
                      {DEFAULT_CATEGORIES.map((category) => (
                        <Link key={category.slug} href={`/categories/${category.slug}`} onClick={() => setCategoriesOpen(false)} className="group flex min-h-11 items-center justify-between gap-2 border-b border-border/70 px-2 text-sm text-foreground/85 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary">
                          <span>{category.name}</span>
                          <span aria-hidden className="text-muted-foreground transition-transform group-hover:translate-x-0.5">↗</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="nav-link whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-primary-400">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Button size="sm" asChild className="hidden whitespace-nowrap sm:inline-flex">
              <Link href="/seller-center">List with us</Link>
            </Button>
            <NotificationBell isSignedIn={!!user} />
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
            )}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-primary-navigation"
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </div>
      </Container>

      <div className="border-y border-foreground/10 bg-background/95 backdrop-blur-md xl:hidden">
        <nav aria-label="Browse categories" className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link href="/marketplace" className="shrink-0 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground">All</Link>
          {DEFAULT_CATEGORIES.map((category) => (
            <Link key={category.slug} href={`/categories/${category.slug}`} className="shrink-0 rounded-full border border-border px-3.5 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:text-primary">
              {category.name}
            </Link>
          ))}
        </nav>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-primary-navigation"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="px-4 pt-2 xl:hidden"
          >
            <div className="site-header-surface mx-auto flex max-w-7xl flex-col gap-1 rounded-2xl p-3">
              <Link href="/marketplace" onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-400">Shop by category</Link>
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {link.label}
                </Link>
              ))}
              <Link
                href="/seller-center"
                onClick={() => setMobileOpen(false)}
                className="mt-1 flex items-center justify-center rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-400"
              >
                List with us
              </Link>
              <div className="mt-1 flex gap-2 border-t border-border pt-3">
                {user ? (
                  <>
                    <Button variant="secondary" size="sm" asChild className="flex-1">
                      <Link href="/buyer" onClick={() => setMobileOpen(false)}>Dashboard</Link>
                    </Button>
                    <form action={signOutAction} className="flex-1">
                      <button type="submit" className="h-9 w-full rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive">
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" asChild className="flex-1">
                    <Link href="/login" onClick={() => setMobileOpen(false)}>Sign in</Link>
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
