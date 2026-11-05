"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Script from "next/script";
import { Cookie, ShieldCheck, X } from "lucide-react";
import {
  clearAnalyticsCookies,
  readConsent,
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
 * If they later switch to essential-only, tracking is disabled and analytics
 * cookies are removed.
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

function CookiePreferencesDialog({
  open,
  onClose,
  initialAnalytics,
}: {
  open: boolean;
  onClose: () => void;
  initialAnalytics: boolean;
}) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(initialAnalytics);

  useEffect(() => {
    if (!open) return;
    setAnalyticsEnabled(initialAnalytics);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, initialAnalytics, onClose]);

  if (!open) return null;

  const save = (analytics: boolean) => {
    writeConsent(analytics ? "all" : "essential");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-preferences-title"
        aria-describedby="cookie-preferences-description"
        className="w-full max-w-xl rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl sm:p-7"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
              <Cookie className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Privacy controls</p>
              <h2 id="cookie-preferences-title" className="mt-1 text-xl font-semibold text-foreground">
                Cookie preferences
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cookie preferences"
            className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p id="cookie-preferences-description" className="mt-4 text-sm leading-6 text-muted-foreground">
          Choose which cookies MaliHub can use. Essential cookies are required for the marketplace to work.
          Optional analytics help us understand site usage and improve the experience.
        </p>

        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border border-border bg-background/60 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Essential cookies</h3>
                  <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    Always on
                  </span>
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Needed for sign-in, account security, saved preferences and checkout. These cannot be switched off.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background/60 p-4">
            <div className="flex items-start gap-3">
              <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Analytics cookies</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Google Analytics</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={analyticsEnabled}
                    aria-label="Allow analytics cookies"
                    onClick={() => setAnalyticsEnabled((enabled) => !enabled)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${analyticsEnabled ? "border-primary bg-primary" : "border-border bg-muted"}`}
                  >
                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${analyticsEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">
                  Helps us understand which pages and features are useful. It is optional and stays off unless you enable it.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => save(false)}
            className="rounded-full border border-border px-5 py-3 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reject optional
          </button>
          <button
            type="button"
            onClick={() => save(analyticsEnabled)}
            className="rounded-full border border-primary/40 px-5 py-3 text-sm font-semibold text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Save preferences
          </button>
          <button
            type="button"
            onClick={() => save(true)}
            className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Accept all
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Read our{" "}
          <Link href="/privacy#cookies" onClick={onClose} className="text-primary underline underline-offset-2 hover:text-primary-400">
            cookie and privacy information
          </Link>.
        </p>
      </section>
    </div>
  );
}

export function CookieBanner() {
  const consent = useConsent();
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  return (
    <>
      {consent === "unset" && (
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
                Your privacy matters
              </h2>
              <p id="cookie-banner-desc" className="mt-1 text-sm leading-6 text-muted-foreground">
                MaliHub uses essential cookies to keep the marketplace secure. With your permission, we also use
                optional analytics cookies to improve the experience.{" "}
                <Link href="/privacy#cookies" className="text-primary underline underline-offset-2 hover:text-primary-400">
                  Learn more
                </Link>
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setPreferencesOpen(true)}
              className="rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Customize
            </button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => writeConsent("essential")}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Reject optional
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
        </div>
      )}
      <CookiePreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        initialAnalytics={consent === "all"}
      />
    </>
  );
}

/** Footer link opens preferences directly without clearing the visitor's choice. */
export function CookieSettingsButton({ className }: { className?: string }) {
  const consent = useConsent();
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setPreferencesOpen(true)}
        className={className}
      >
        Cookie settings
      </button>
      <CookiePreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        initialAnalytics={consent === "all"}
      />
    </>
  );
}
