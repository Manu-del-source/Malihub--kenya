"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import Script from "next/script";
import { Cookie } from "lucide-react";
import {
  clearAnalyticsCookies,
  readConsent,
  resetConsent,
  subscribeConsent,
  writeConsent,
  type ConsentState,
} from "@/lib/cookie-consent";

const GA_ID = "G-8XD22ZZD9X";

/** "pending" on the server and during hydration so nothing flashes. */
function useConsent(): ConsentState | "pending" {
  return useSyncExternalStore<ConsentState | "pending">(
    subscribeConsent,
    readConsent,
    () => "pending",
  );
}

/**
 * Google Analytics only loads after the visitor accepts analytics cookies.
 * If they later switch to "essential only", tracking is disabled and the
 * analytics cookies are removed.
 */
export function ConsentGatedAnalytics() {
  const consent = useConsent();

  useEffect(() => {
    if (consent === "pending") return;
    (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = consent !== "all";
    if (consent !== "all") clearAnalyticsCookies();
  }, [consent]);

  if (consent !== "all") return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}

export function CookieBanner() {
  const consent = useConsent();
  if (consent !== "unset") return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-desc"
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-2xl sm:bottom-5 sm:p-5"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/25 bg-gold/10 text-gold">
          <Cookie className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="cookie-banner-title" className="text-sm font-semibold text-foreground">
            We use cookies
          </h2>
          <p id="cookie-banner-desc" className="mt-1 text-sm leading-6 text-muted-foreground">
            Essential cookies keep you signed in and your checkout secure. With your permission we also use analytics
            cookies to understand how MaliHub is used and improve it.{" "}
            <Link href="/privacy#cookies" className="text-primary underline underline-offset-2 hover:text-primary-400">
              Privacy policy
            </Link>
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => writeConsent("essential")}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => writeConsent("all")}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}

/** Footer link that lets visitors change their choice later. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={resetConsent} className={className}>
      Cookie settings
    </button>
  );
}
