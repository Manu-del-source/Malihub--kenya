import Link from "next/link";
import { Facebook, Instagram } from "lucide-react";
import { Container } from "@/components/ui/container";
import { CookieSettingsButton } from "@/components/cookie-consent";
import {
  FACEBOOK_URL,
  FOOTER_GROUPS,
  INSTAGRAM_URL,
  SUPPORT_WHATSAPP_URL,
} from "@/components/landing/footer-links";
import { SUPPORT_WHATSAPP } from "@/lib/support";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// 44px minimum tap target on every footer link.
const LINK = `footer-link inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary-400 ${FOCUS}`;
const ICON_BUTTON = `inline-flex h-11 w-11 items-center justify-center rounded-full border border-foreground/10 text-muted-foreground transition-colors hover:border-primary-400/50 hover:text-primary-400 ${FOCUS}`;

export function SiteFooter() {
  return (
    <footer className="site-footer relative overflow-hidden border-t border-foreground/[0.08]">
      <div className="footer-glow pointer-events-none absolute inset-x-0 top-0 h-48" aria-hidden />
      <Container className="relative py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
          {/* Brand + primary contact */}
          <div className="flex flex-col items-start gap-4">
            <Link href="/" className={`group flex items-center gap-2.5 rounded-full ${FOCUS}`} aria-label="MaliHub home">
              <span aria-hidden className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-[#17110a]">M</span>
              <span className="font-display text-xl font-semibold tracking-tight">Mali<span className="text-primary-400">Hub</span></span>
            </Link>
            <p className="max-w-xs text-sm leading-6 text-muted-foreground">
              Products and local listings from independent sellers across Kenya.
            </p>

            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`group inline-flex min-h-12 w-full max-w-xs items-center gap-3 rounded-xl border border-primary-400/25 bg-primary-400/[0.06] px-4 py-3 transition-colors hover:border-primary-400/50 hover:bg-primary-400/[0.10] ${FOCUS}`}
              aria-label={`Chat with MaliHub support on WhatsApp at ${SUPPORT_WHATSAPP}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-400/15 text-primary-400" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" role="img" aria-label="WhatsApp"><path d="M20.52 3.48A11.8 11.8 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.37-1.67a11.86 11.86 0 0 0 5.67 1.44h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.24-6.15-3.39-8.43zM12.05 21.75h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.78.99 1.01-3.69-.23-.38a9.84 9.84 0 0 1-1.51-5.22c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.89-9.89 9.89zm5.43-7.4c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01s-.52.07-.79.37c-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.31 1.26.5 1.69.64.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z"/></svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary-400">Chat with us on WhatsApp</span>
                <span className="text-xs text-muted-foreground">{SUPPORT_WHATSAPP}</span>
              </span>
            </a>

            <div className="flex items-center gap-2">
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Follow MaliHub on Instagram" className={ICON_BUTTON}>
                <Instagram className="h-4 w-4" aria-hidden />
              </a>
              <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" aria-label="Follow MaliHub on Facebook" className={ICON_BUTTON}>
                <Facebook className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </div>

          {/* Link groups: 2×2 on phones, one row of four from md */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground">{group.heading}</h3>
                <ul className="flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={LINK}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  {group.includeCookieSettings && (
                    <li>
                      <CookieSettingsButton className={`${LINK} text-left`} />
                    </li>
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-foreground/[0.08] pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} MaliHub Kenya. All rights reserved.</p>
          <p className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-400" aria-hidden /> Made in Kenya, for Kenya <span aria-hidden>🇰🇪</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
