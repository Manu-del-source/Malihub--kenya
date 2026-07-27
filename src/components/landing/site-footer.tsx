import Link from "next/link";
import { Facebook, Instagram, Twitter, Linkedin } from "lucide-react";
import { Container } from "@/components/ui/container";

const FOOTER_LINKS = {
  Marketplace: [
    { label: "Explore listings", href: "/search" },
    { label: "Categories", href: "/#categories" },
    { label: "Sell on MaliHub", href: "/register?role=seller" },
    { label: "Verified sellers", href: "/#why-malihub" },
  ],
  Company: [
    { label: "About us", href: "/about" },
    { label: "Careers", href: "/careers" },
    { label: "Blog", href: "/blog" },
    { label: "Press", href: "/press" },
  ],
  Support: [
    { label: "Help center", href: "/support" },
    { label: "Safety tips", href: "/safety" },
    { label: "Contact us", href: "/contact" },
    { label: "Report a listing", href: "/report" },
  ],
  Legal: [
    { label: "Terms of service", href: "/terms" },
    { label: "Privacy policy", href: "/privacy" },
    { label: "Cookie policy", href: "/cookies" },
  ],
};

const SOCIALS = [
  { label: "Facebook", href: "https://facebook.com", icon: Facebook },
  { label: "Twitter", href: "https://twitter.com", icon: Twitter },
  { label: "Instagram", href: "https://instagram.com", icon: Instagram },
  { label: "LinkedIn", href: "https://linkedin.com", icon: Linkedin },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-16">
      <Container>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 flex flex-col gap-4 sm:col-span-3 lg:col-span-2">
            <Link href="/" className="flex items-center gap-2 font-display text-lg font-medium">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground"
              >
                M
              </span>
              MaliHub
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">
              A premium marketplace to buy and sell across all 47 Kenyan counties,
              with secure M-Pesa payments and verified sellers.
            </p>
            <div className="flex gap-2">
              {SOCIALS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary-400"
                >
                  <social.icon className="h-4 w-4" aria-hidden />
                </a>
              ))}
            </div>
          </div>

          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <nav key={heading} aria-label={heading}>
              <h3 className="mb-4 text-sm font-medium text-foreground">{heading}</h3>
              <ul className="flex flex-col gap-3">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} MaliHub Kenya. All rights reserved.</p>
          <p>Made in Kenya, for Kenya 🇰🇪</p>
        </div>
      </Container>
    </footer>
  );
}
