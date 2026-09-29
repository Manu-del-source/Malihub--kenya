import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// The helper delegates administrator detection to the auth layer, which is
// server-only — substitute the marker module and the auth module before the
// helper loads (same pattern as the other service suites).
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", {
  namedExports: {
    isAdministratorRole: (role: string) => role === "ADMIN" || role === "SUPER_ADMIN",
  },
});

let visibility: typeof import("@/lib/listing-visibility");

before(async () => {
  visibility = await import("@/lib/listing-visibility");
});

const OWNER = "owner-user";
const STRANGER = "stranger-user";

function listing(status: string) {
  return { status, ownerId: OWNER };
}

/**
 * The one visibility rule, pinned as a truth table — both detail pages and
 * GET /api/products/[id] call this helper, so a regression here is a draft
 * leak on every public surface at once.
 */
describe("listing visibility — one rule for pages and API", () => {
  it("shows ACTIVE and SOLD listings to everyone, including anonymous visitors", () => {
    for (const status of ["ACTIVE", "SOLD"]) {
      assert.equal(visibility.canViewListing(listing(status), null), true, status);
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "BUYER" }),
        true,
        status
      );
    }
    assert.equal(visibility.isPublicListingStatus("ACTIVE"), true);
    assert.equal(visibility.isPublicListingStatus("SOLD"), true);
  });

  it("hides every non-public status from anonymous visitors", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "ARCHIVED", "SUSPENDED", "REMOVED"]) {
      assert.equal(visibility.isPublicListingStatus(status), false, status);
      assert.equal(visibility.canViewListing(listing(status), null), false, status);
    }
  });

  it("hides non-public listings from other signed-in users", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "ARCHIVED", "SUSPENDED", "REMOVED"]) {
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "BUYER" }),
        false,
        status
      );
      // Even a fellow SELLER (or one with the admin *role string* but not a
      // real admin role) gets nothing on someone else's listing.
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "SELLER" }),
        false,
        status
      );
    }
  });

  it("shows non-public listings to their owner and to administrators", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "ARCHIVED", "SUSPENDED", "REMOVED"]) {
      assert.equal(
        visibility.canViewListing(listing(status), { id: OWNER, role: "BUYER" }),
        true,
        `${status} for owner`
      );
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "ADMIN" }),
        true,
        `${status} for admin`
      );
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "SUPER_ADMIN" }),
        true,
        `${status} for super admin`
      );
    }
  });
});
