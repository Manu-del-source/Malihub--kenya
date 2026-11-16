import { BUYER_ORDERS_PATH, SELLER_ORDERS_PATH } from "@/lib/dashboard-nav";

/**
 * Phone bottom bar. Two modes, five tabs each (3–5 is the usable range for a
 * thumb-reachable bar), following the marketplace pattern of separating the
 * shopping app from the seller workspace (cf. Jumia's separate Vendor Center):
 *
 *  - shop:   Home · Categories · Cart · Messages · Account
 *  - seller: Overview · Orders · Listings · Messages · More   (inside /seller)
 *
 * Orders (buyer) live on the Account page's status strip; Admin and Seller
 * Centre are entered from Account. The bar therefore never grows with roles.
 */
export type MobileMode = "shop" | "seller";

export type MobileTabKey =
  | "home" | "categories" | "cart" | "messages" | "account"
  | "seller-overview" | "seller-orders" | "seller-listings" | "seller-messages" | "seller-more";

export type MobileTab = {
  key: MobileTabKey;
  label: string;
  href: string;
  /** Paths (prefix match, `/`-aware) that make this tab the active one. */
  match: readonly string[];
};

export function mobileMode(pathname: string, hasSellerProfile: boolean): MobileMode {
  const inSeller = pathname === "/seller" || pathname.startsWith("/seller/");
  return hasSellerProfile && inSeller ? "seller" : "shop";
}

export function buildMobileTabs({ mode }: { mode: MobileMode }): MobileTab[] {
  if (mode === "seller") {
    return [
      { key: "seller-overview", label: "Overview", href: "/seller", match: ["/seller"] },
      { key: "seller-orders", label: "Orders", href: SELLER_ORDERS_PATH, match: [SELLER_ORDERS_PATH] },
      { key: "seller-listings", label: "Listings", href: "/seller/listings", match: ["/seller/listings"] },
      { key: "seller-messages", label: "Messages", href: "/seller/messages", match: ["/seller/messages"] },
      {
        key: "seller-more",
        label: "More",
        href: "/seller/menu",
        match: [
          "/seller/menu", "/seller/products", "/seller/sales", "/seller/supplier-orders",
          "/seller/supplier-catalog", "/seller/suppliers", "/seller/onboarding",
        ],
      },
    ];
  }
  return [
    { key: "home", label: "Home", href: "/", match: ["/"] },
    { key: "categories", label: "Categories", href: "/marketplace", match: ["/marketplace"] },
    { key: "cart", label: "Cart", href: "/buyer/cart", match: ["/buyer/cart"] },
    { key: "messages", label: "Messages", href: "/messages", match: ["/messages"] },
    {
      key: "account",
      label: "Account",
      href: "/account",
      // My orders, wishlist and the role entry points all live under Account.
      match: ["/account", "/admin", "/buyer", BUYER_ORDERS_PATH, "/notifications", "/complete-profile", "/seller-center"],
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
