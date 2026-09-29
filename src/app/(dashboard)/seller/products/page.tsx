import { redirect } from "next/navigation";

/**
 * Canonical product-management entry point.
 *
 * The implementation lives at `/seller/listings` (with its server actions and
 * row components); this route exists so the documented `/seller/products` URL
 * resolves to the same screens instead of a second, divergent copy.
 *
 * Ownership, authentication and CSRF protections are exactly the ones the
 * target route enforces — middleware gates `/seller/*` on a Neon Auth session
 * and every mutation re-derives the seller from the session server-side.
 */
export default function SellerProductsRedirect() {
  redirect("/seller/listings");
}
