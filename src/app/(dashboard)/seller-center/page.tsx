import { redirect } from "next/navigation";

/**
 * Canonical Seller Centre entry point. The existing seller workspace remains
 * under /seller so existing links, integrations and bookmarks continue to work.
 * Access is enforced by the destination's requireSellerAccess guard.
 */
export const dynamic = "force-dynamic";

export default function SellerCentrePage() {
  redirect("/seller");
}
