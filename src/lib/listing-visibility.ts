import type { UserRole } from "@prisma/client";
import { isAdministratorRole } from "@/lib/auth";

/**
 * The single visibility rule for listings, shared by BOTH detail routes
 * (`/marketplace/[productId]` and `/products/[slug]`) and
 * `GET /api/products/[id]` so the pages and the API can never drift apart.
 *
 *  - `ACTIVE` and `SOLD` are public — anyone may read them.
 *  - every other status (DRAFT, PENDING_REVIEW, ARCHIVED, SUSPENDED, REMOVED)
 *    is visible ONLY to the listing's owner and to administrators. The rule
 *    is enforced against the *session* viewer — nothing in the request
 *    decides it — so knowing a listing's UUID never exposes an unpublished
 *    product (or its seller) to the public.
 *
 * An anonymous or non-owner, non-admin viewer yields 404 rather than a 403,
 * so an unpublished id can't be probed for existence.
 */

const PUBLIC_LISTING_STATUSES = new Set(["ACTIVE", "SOLD"]);

export function isPublicListingStatus(status: string): boolean {
  return PUBLIC_LISTING_STATUSES.has(status);
}

export function canViewListing(
  listing: { status: string; ownerId: string },
  viewer: { id: string; role: UserRole } | null | undefined
): boolean {
  if (isPublicListingStatus(listing.status)) return true;
  if (!viewer) return false;
  return viewer.id === listing.ownerId || isAdministratorRole(viewer.role);
}
