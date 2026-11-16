import { buildDashboardNav, type DashboardNavItem } from "@/lib/dashboard-nav";

/**
 * Phone "More" menu for the seller workspace: every seller page that is not a
 * bottom tab. Built from the same nav source as desktop so the verification
 * gating can't drift (Products, Sales, Supplier orders need a verified seller).
 * Only pages that exist are listed.
 */
export function buildSellerMenu({ isAdmin, sellerVerified }: { isAdmin: boolean; sellerVerified: boolean }): DashboardNavItem[] {
  const { sellerArea } = buildDashboardNav({ hasSellerProfile: true, isAdmin, sellerVerified });
  const inBar = new Set(["/seller", "/seller/orders", "/seller/listings", "/seller/messages"]);
  return sellerArea.filter((item) => !inBar.has(item.href));
}
