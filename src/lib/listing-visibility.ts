import type { UserRole } from "@prisma/client";
import { isAdministratorRole } from "@/lib/auth";

/**
 * The single visibility rule for listings, shared by BOTH detail routes
 * (`/marketplace/[productId]` and `/products/[slug]`) and
 * `GET /api/products/[id]` so the pages and the API can never drift apart.
 *
 *  - ACTIVE and SOLD listings are public when the seller is VERIFIED, OR
 *    when the listing is owned by an administrator (admin-managed catalogue).
 *  - every other status is visible ONLY to the listing's owner and to
 *    administrators.
 *
 * The owner role is read from the database, never from request input. An
 * anonymous or unauthorized viewer receives 404 so unpublished listings
 * cannot be probed for existence.
 */

const PUBLIC_LISTING_STATUSES = new Set(["ACTIVE", "SOLD"]);

export function isPublicListingStatus(status: string): boolean {
  return PUBLIC_LISTING_STATUSES.has(status);
}

export function canViewListing(
  listing: {
    status: string;
    ownerId: string;
    ownerRole?: UserRole;
    seller?: { verificationStatus?: string } | null;
  },
  viewer: { id: string; role: UserRole } | null | undefined
): boolean {
  const isOwnerOrAdmin = Boolean(
    viewer && (viewer.id === listing.ownerId || isAdministratorRole(viewer.role))
  );

  const isPublicAdminManagedListing =
    isPublicListingStatus(listing.status) &&
    isAdministratorRole(listing.ownerRole);

  if (
    isPublicListingStatus(listing.status) &&
    (listing.seller?.verificationStatus === "VERIFIED" || isPublicAdminManagedListing)
  ) return true;

  return isOwnerOrAdmin;
}
