"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function isInstalledApp(): boolean {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

function isAppProductWorkflow(pathname: string): boolean {
  return (
    pathname === "/seller/listings" ||
    pathname.startsWith("/seller/listings/") ||
    pathname === "/seller/products" ||
    pathname.startsWith("/seller/products/")
  );
}

/**
 * The installed app keeps the high-frequency product workflows available.
 * Registration, onboarding and the wider Seller Centre remain browser-first.
 */
export function SellerBrowserGate({ children }: { children: ReactNode }) {
  const [standalone, setStandalone] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setStandalone(isInstalledApp());
  }, []);

  if (standalone === null) {
    return <div className="min-h-[55svh] bg-background" aria-label="Loading MaliHub" />;
  }

  if (!standalone || isAppProductWorkflow(pathname)) return children;

  return (
    <main className="flex min-h-[75svh] items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-2xl font-bold text-primary">M</div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-300">MaliHub Seller Centre</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Your shop, wherever you work</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          Add products, edit listings and upload photos right here in the app. For registration, verification and the full Seller Centre, continue in your phone&apos;s browser.
        </p>
        <Link href="/seller/listings" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400">
          Manage products in the app
        </Link>
        <a href={pathname || "/seller"} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-muted">
          Open full Seller Centre in browser
        </a>
        <Link href="/marketplace" className="mt-3 inline-flex min-h-10 items-center justify-center px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground">
          Continue shopping
        </Link>
      </section>
    </main>
  );
}
