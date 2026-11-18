import { BUYER_ORDERS_PATH } from "@/lib/dashboard-nav";

/**
 * The installed MaliHub app is a buyer companion. Seller operations remain
 * available through the full website's Seller Centre, not a second mobile
 * navigation mode.
 */
export type MobileTabKey = "home" | "categories" | "cart" | "messages" | "account";

export type MobileTab = {
  key: MobileTabKey;
  label: string;
  href: string;
  /** Paths (prefix match, `/`-aware) that make this tab the active one. */
  match: readonly string[];
};

export function buildMobileTabs(): MobileTab[] {
  return [
    { key: "home", label: "Home", href: "/app", match: ["/app"] },
    { key: "categories", label: "Categories", href: "/marketplace", match: ["/marketplace"] },
    { key: "cart", label: "Cart", href: "/buyer/cart", match: ["/buyer/cart"] },
    { key: "messages", label: "Messages", href: "/messages", match: ["/messages"] },
    {
      key: "account",
      label: "Account",
      href: "/account",
      // Buyer orders, wishlist, profile and seller-centre entry all live here.
      match: ["/account", "/admin", "/buyer", BUYER_ORDERS_PATH, "/notifications", "/complete-profile", "/seller-center", "/seller"],
    },
  ];
}

function matches(prefix: string, pathname: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The most specific matching prefix wins, so /buyer/cart is Cart, not Account. */
export function activeMobileTab(tabs: readonly MobileTab[], pathname: string): MobileTabKey | null {
  let best: { key: MobileTabKey; length: number } | null = null;
  for (const tab of tabs) {
    for (const prefix of tab.match) {
      if (matches(prefix, pathname) && (!best || prefix.length > best.length)) {
        best = { key: tab.key, length: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}
