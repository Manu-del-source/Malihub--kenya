/** Footer navigation. Every internal href must resolve to a real page (see footer-links.test.ts). */
export type FooterLink = { label: string; href: string };
export type FooterGroup = { heading: string; links: FooterLink[]; includeCookieSettings?: boolean };

export const SUPPORT_EMAIL = "support@malihubke.online";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=MaliHub%20Support`;
export const INSTAGRAM_URL = "https://www.instagram.com/malihubke/";
export const FACEBOOK_URL = "https://www.facebook.com/share/1ZiYTdJ5X3/";

export const FOOTER_GROUPS: FooterGroup[] = [
  {
    heading: "Shop",
    links: [
      { label: "Explore listings", href: "/marketplace" },
      { label: "Categories", href: "/#categories" },
    ],
  },
  {
    heading: "Sell",
    links: [
      { label: "Start selling", href: "/seller-center" },
      { label: "Become a supplier", href: "/become-a-supplier" },
    ],
  },
  {
    heading: "Help",
    links: [
      { label: "Support & safety", href: "/support" },
      { label: "Email support", href: SUPPORT_MAILTO },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms of service", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
    ],
    includeCookieSettings: true,
  },
];
