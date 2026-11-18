"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { AccountMenu, type HeaderUser } from "@/components/landing/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { signOutAction } from "@/app/(auth)/actions";
import { useTheme } from "@/providers/theme-provider";

const NAV_LINKS = [
  { label: "Explore", href: "/marketplace" },
  { label: "Categories", href: "/#categories" },
  { label: "Suppliers", href: "/become-a-supplier" },
  { label: "Contact", href: "/contact" },
];

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

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
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </button>
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
