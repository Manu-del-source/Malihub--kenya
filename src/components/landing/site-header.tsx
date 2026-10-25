"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { AccountMenu, type HeaderUser } from "@/components/landing/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { signOutAction } from "@/app/(auth)/actions";

const NAV_LINKS = [
  { label: "Explore", href: "/marketplace" },
  { label: "Categories", href: "/#categories" },
  { label: "How it works", href: "/#why-malihub" },
  { label: "Sell on MaliHub", href: "/#sell" },
];

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <Container className="pt-3 sm:pt-4">
        <div className="site-header-surface flex items-center justify-between rounded-2xl px-3 py-2.5 sm:rounded-full sm:px-5">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="MaliHub home">
            <Image src="/icons/logo.svg" alt="" aria-hidden width={36} height={36} priority className="rounded-xl transition-transform group-hover:rotate-[-5deg]" />
            <span className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              Mali<span className="text-primary-400">Hub</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="nav-link text-sm font-medium text-muted-foreground transition-colors hover:text-primary-400">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationBell isSignedIn={!!user} />

            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button variant="primary" size="sm" asChild className="hidden sm:inline-flex">
                  <Link href="/register?role=seller">
                    Start selling <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-primary-navigation"
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </div>
      </Container>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-primary-navigation"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="px-4 pt-2 lg:hidden"
          >
            <div className="site-header-surface mx-auto flex max-w-7xl flex-col gap-1 rounded-2xl p-3">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {link.label}
                </Link>
              ))}
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
                  <>
                    <Button variant="secondary" size="sm" asChild className="flex-1">
                      <Link href="/login" onClick={() => setMobileOpen(false)}>Sign in</Link>
                    </Button>
                    <Button variant="primary" size="sm" asChild className="flex-1">
                      <Link href="/register?role=seller" onClick={() => setMobileOpen(false)}>Start selling</Link>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
