import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { Container } from "@/components/ui/container";

const FOOTER_LINKS = {
  Marketplace: [
    { label: "Explore listings", href: "/marketplace" },
    { label: "Categories", href: "/#categories" },
    { label: "How it works", href: "/#why-malihub" },
  ],
  Help: [
    { label: "Support & safety", href: "/support" },
    { label: "Email support", href: "mailto:support@malihubke.online?subject=MaliHub%20Support" },
  ],
  Legal: [
    { label: "Terms of service", href: "/terms" },
    { label: "Privacy policy", href: "/privacy" },
  ],
};

export function SiteFooter() {
  return (
    <footer className="site-footer relative overflow-hidden border-t border-foreground/[0.08]">
      <div className="footer-glow pointer-events-none absolute inset-x-0 top-0 h-48" aria-hidden />
      <Container className="relative py-12 sm:py-16">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-12">
          <div className="col-span-2 flex flex-col items-start gap-5 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="group flex items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="MaliHub home">
              <span aria-hidden className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-[#17110a]">M</span>
              <span className="font-display text-xl font-semibold tracking-tight">Mali<span className="text-primary-400">Hub</span></span>
            </Link>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              A marketplace for discovering listings and connecting with sellers across Kenya.
            </p>
            <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm font-medium text-primary-400 transition-colors hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Explore the marketplace <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href="mailto:support@malihubke.online?subject=MaliHub%20Support" className="inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Mail className="h-3.5 w-3.5" aria-hidden /> support@malihubke.online
            </a>
          </div>

          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <nav key={heading} aria-label={heading}>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-foreground">{heading}</h3>
              <ul className="flex flex-col gap-3">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="footer-link text-sm text-muted-foreground transition-colors hover:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-foreground/[0.08] pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} MaliHub Kenya. All rights reserved.</p>
          <p className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary-400" aria-hidden /> Made in Kenya, for Kenya <span aria-hidden>🇰🇪</span></p>
        </div>
      </Container>
    </footer>
  );
}
