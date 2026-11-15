import { ADMIN_DASHBOARD_PATH, SELLER_DASHBOARD_PATH } from "@/lib/auth/config";

export type DashboardNavItem = { label: string; href: string };

export const SELLER_ORDERS_PATH = `${SELLER_DASHBOARD_PATH}/orders`;
export const BUYER_ORDERS_PATH = "/buyer/orders";

/**
 * Builds the dashboard navigation.
 *
 * "Orders" is deliberately NOT gated on seller verification. Fulfilment
 * authority is enforced on the server (see `updateSellerOrderFulfilment`);
 * hiding the entry point only made shipment confirmation undiscoverable for
 * any seller whose verification state changed after orders were placed.
 * Listing-creation entries stay verification-gated.
 */
export function buildDashboardNav({
  hasSellerProfile,
  isAdmin,
  sellerVerified,
}: {
  hasSellerProfile: boolean;
  isAdmin: boolean;
  sellerVerified: boolean;
}): { primary: DashboardNavItem[]; account: DashboardNavItem[]; sellerArea: DashboardNavItem[] } {
  const primary: DashboardNavItem[] = [
    { label: "Marketplace", href: "/marketplace" },
    { label: "Wishlist", href: "/buyer/wishlist" },
  ];

  if (hasSellerProfile || isAdmin) {
    primary.push(
      { label: "Dashboard", href: SELLER_DASHBOARD_PATH },
      { label: "Orders", href: SELLER_ORDERS_PATH },
      { label: "Supplier catalog", href: `${SELLER_DASHBOARD_PATH}/suppliers` },
    );
    if (sellerVerified || isAdmin) {
      primary.push(
        { label: "Products", href: `${SELLER_DASHBOARD_PATH}/products` },
        { label: "Supplier orders", href: `${SELLER_DASHBOARD_PATH}/supplier-orders` },
        { label: "Sales", href: `${SELLER_DASHBOARD_PATH}/sales` },
      );
    }
    // Sellers also buy: keep their own purchases reachable.
    primary.push({ label: "My orders", href: BUYER_ORDERS_PATH });
  } else {
    primary.push({ label: "My orders", href: BUYER_ORDERS_PATH });
  }

  const account: DashboardNavItem[] = [
    { label: "Messages", href: "/messages" },
    { label: "Profile", href: "/account" },
  ];
  if (isAdmin) account.push({ label: "Admin", href: ADMIN_DASHBOARD_PATH });

  // Phone sub-navigation shown only inside /seller (the bottom bar stays at five tabs).
  const sellerArea = primary.filter((item) => item.href.startsWith(SELLER_DASHBOARD_PATH));

  return { primary, account, sellerArea };
}
