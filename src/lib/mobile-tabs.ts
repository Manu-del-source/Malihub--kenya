import { BUYER_ORDERS_PATH, SELLER_ORDERS_PATH } from "@/lib/dashboard-nav";

export type MobileTabKey = "home" | "categories" | "orders" | "messages" | "account";

export type MobileTab = {
  key: MobileTabKey;
  label: string;
  href: string;
  /** Paths (prefix match, `/`-aware) that make this tab the active one. */
  match: readonly string[];
};

/**
 * The phone bottom bar is capped at FIVE tabs. Roles (Seller Centre, Admin) are
 * reached from the Account tab, and Cart lives in the header, so the bar never
 * grows with the user's roles. Orders is role-aware.
 */
export function buildMobileTabs({ hasSellerProfile }: { hasSellerProfile: boolean }): MobileTab[] {
  return [
    { key: "home", label: "Home", href: "/", match: ["/"] },
    { key: "categories", label: "Categories", href: "/marketplace", match: ["/marketplace"] },
    {
      key: "orders",
      label: "Orders",
      href: hasSellerProfile ? SELLER_ORDERS_PATH : BUYER_ORDERS_PATH,
      match: [BUYER_ORDERS_PATH, SELLER_ORDERS_PATH],
    },
    { key: "messages", label: "Messages", href: "/messages", match: ["/messages"] },
    {
      key: "account",
      label: "Account",
      href: "/account",
      match: ["/account", "/admin", "/seller", "/seller-center", "/buyer/wishlist", "/notifications", "/complete-profile"],
    },
  ];
}

function matches(prefix: string, pathname: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The most specific matching prefix wins, so /seller/orders is Orders, not Account. */
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
