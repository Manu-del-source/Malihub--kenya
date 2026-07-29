"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Moon, Sun, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { useTheme } from "@/providers/theme-provider";
import { AccountMenu, type HeaderUser } from "@/components/landing/account-menu";
import { signOutAction } from "@/app/(auth)/actions";

const NAV_LINKS = [
  { label: "Explore", href: "/search" },
  { label: "Categories", href: "/#categories" },
  { label: "How it works", href: "/#why-malihub" },
  { label: "Sell on MaliHub", href: "/#sell" },
];

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <Container className="pt-4">
        <div className="glass flex items-center justify-between rounded-full px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-medium">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground"
            >
              M
            </span>
            MaliHub
          </Link>

          <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

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

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground lg:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </Container>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="px-4 pt-2 lg:hidden"
          >
            <div className="glass flex flex-col gap-1 rounded-2xl p-3">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-1 flex gap-2 border-t border-border pt-3">
                {user ? (
                  <>
                    <Button variant="secondary" size="sm" asChild className="flex-1">
                      <Link href="/dashboard/buyer" onClick={() => setMobileOpen(false)}>
                        Dashboard
                      </Link>
                    </Button>
                    <form action={signOutAction} className="flex-1">
                      <button
                        type="submit"
                        className="h-9 w-full rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                      >
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" asChild className="flex-1">
                      <Link href="/login">Sign in</Link>
                    </Button>
                    <Button variant="primary" size="sm" asChild className="flex-1">
                      <Link href="/register">Start selling</Link>
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
