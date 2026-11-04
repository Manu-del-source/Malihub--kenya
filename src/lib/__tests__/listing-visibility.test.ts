import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { UserRole } from "@prisma/client";

// The helper delegates administrator detection to the auth layer, which is
// server-only — substitute the marker module and the auth module before it loads.
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

function listing(status: string, verificationStatus = "VERIFIED", ownerRole: UserRole = "SELLER") {
  return { status, ownerId: OWNER, ownerRole, seller: { verificationStatus } };
}

describe("listing visibility — one rule for pages and API", () => {
  it("shows ACTIVE and SOLD listings from verified sellers to everyone", () => {
    for (const status of ["ACTIVE", "SOLD"]) {
      assert.equal(visibility.canViewListing(listing(status), null), true, status);
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "BUYER" }),
        true,
        status
      );
    }
  });

  it("shows ACTIVE and SOLD admin-owned catalogue listings to everyone, even if the seller is unverified", () => {
    for (const status of ["ACTIVE", "SOLD"]) {
      for (const verificationStatus of ["UNVERIFIED", "PENDING", "REJECTED"]) {
        assert.equal(
          visibility.canViewListing(listing(status, verificationStatus, "ADMIN"), null),
          true,
          `${status} / ${verificationStatus} / ADMIN`
        );
        assert.equal(
          visibility.canViewListing(
            listing(status, verificationStatus, "SUPER_ADMIN"),
            { id: STRANGER, role: "BUYER" }
          ),
          true,
          `${status} / ${verificationStatus} / SUPER_ADMIN`
        );
      }
    }
  });

  it("does not make an unverified seller's own listing public just because a buyer has an admin role string", () => {
    assert.equal(
      visibility.canViewListing(listing("ACTIVE", "PENDING", "SELLER"), null),
      false
    );
    assert.equal(
      visibility.canViewListing(listing("ACTIVE", "PENDING", "SELLER"), {
        id: STRANGER,
        role: "BUYER",
      }),
      false
    );
  });

  it("hides every non-public status from anonymous visitors", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "ARCHIVED", "SUSPENDED", "REMOVED"]) {
      assert.equal(visibility.isPublicListingStatus(status), false, status);
      assert.equal(visibility.canViewListing(listing(status), null), false, status);
      // Admin ownership does not bypass unpublished/non-public statuses.
      assert.equal(visibility.canViewListing(listing(status, "PENDING", "ADMIN"), null), false);
    }
  });

  it("hides non-public listings from other signed-in users", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "ARCHIVED", "SUSPENDED", "REMOVED"]) {
      assert.equal(
        visibility.canViewListing(listing(status), { id: STRANGER, role: "BUYER" }),
        false,
        status
      );
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
