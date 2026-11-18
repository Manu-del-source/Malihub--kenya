"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

function isInstalledApp(): boolean {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

/** Seller workflows stay on the website; the installed app is buyer-focused. */
export function SellerBrowserGate({ children }: { children: ReactNode }) {
  const [standalone, setStandalone] = useState<boolean | null>(null);

  useEffect(() => {
    setStandalone(isInstalledApp());
  }, []);

  if (standalone === null) {
    return <div className="min-h-[55svh] bg-background" aria-label="Loading MaliHub" />;
  }

  if (!standalone) return children;

  return (
    <main className="flex min-h-[75svh] items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-2xl font-bold text-primary">M</div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-300">MaliHub Seller Centre</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Seller tools are available on our website</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          The MaliHub app is designed for shopping. To register as a seller or manage your shop, open the Seller Centre in your phone's web browser.
        </p>
        <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-400">
          Open in browser
        </a>
        <Link href="/marketplace" className="mt-3 inline-flex min-h-10 items-center justify-center px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground">
          Continue shopping
        </Link>
      </section>
    </main>
  );
}
