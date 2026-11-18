import Link from "next/link";
import { Facebook, Instagram, Mail, MessageCircle } from "lucide-react";
import { Container } from "@/components/ui/container";
import { CookieSettingsButton } from "@/components/cookie-consent";
import {
  FACEBOOK_URL,
  FOOTER_GROUPS,
  INSTAGRAM_URL,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
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
          {/* Brand + contact */}
          <div className="flex flex-col items-start gap-4">
            <Link href="/" className={`group flex items-center gap-2.5 rounded-full ${FOCUS}`} aria-label="MaliHub home">
              <span aria-hidden className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-[#17110a]">M</span>
              <span className="font-display text-xl font-semibold tracking-tight">Mali<span className="text-primary-400">Hub</span></span>
            </Link>
            <p className="max-w-xs text-sm leading-6 text-muted-foreground">
              Products and local listings from independent sellers across Kenya.
            </p>
            <div className="w-full max-w-xl">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground">Contact</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <a
                  href={SUPPORT_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-foreground/10 px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary-400/50 hover:text-primary-400 ${FOCUS}`}
                >
                  <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                  <span>WhatsApp {SUPPORT_WHATSAPP}</span>
                </a>
                <a
                  href={SUPPORT_MAILTO}
                  className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-foreground/10 px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary-400/50 hover:text-primary-400 ${FOCUS}`}
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="break-all">{SUPPORT_EMAIL}</span>
                </a>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Follow MaliHub on Instagram" className={ICON_BUTTON}>
                  <Instagram className="h-4 w-4" aria-hidden />
                </a>
                <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" aria-label="Follow MaliHub on Facebook" className={ICON_BUTTON}>
                  <Facebook className="h-4 w-4" aria-hidden />
                </a>
              </div>
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
