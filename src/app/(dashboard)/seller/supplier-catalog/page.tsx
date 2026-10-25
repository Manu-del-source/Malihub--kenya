import { redirect } from "next/navigation";

/**
 * Canonical supplier-catalog entry point.
 *
 * Redirects to `/seller/suppliers` where the supplier sourcing catalog is hosted.
 */
export default function SellerSupplierCatalogRedirect() {
  redirect("/seller/suppliers");
}
