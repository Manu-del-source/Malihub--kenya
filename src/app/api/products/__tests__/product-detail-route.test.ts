import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createFakeMarketplaceStore,
  seedCategory,
  seedProduct,
  seedSeller,
  type FakeMarketplaceStore,
} from "@/services/__tests__/fake-marketplace-store";

/**
 * `/api/products/[id]` visibility and mutation gates.
 *
 * The regression this pins: a draft/archived/removed listing used to be
 * readable by ANYONE who knew its UUID (the GET returned the full row,
 * including the seller). Now non-ACTIVE/SOLD rows answer 404 unless the
 * session belongs to the owner or an administrator — and even an
 * "administrator" answer comes from MaliHub's own role row, read server-side.
 *
 * Mutations additionally run behind the CSRF guard and require a session.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

type SessionUser = { id: string; email: string; role: string } | null;
let sessionUser: SessionUser = null;
let isAdmin = false;

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: store } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser
        ? {
            identity: { authUserId: "neon-1" },
            user: {
              id: sessionUser.id,
              email: sessionUser.email,
              phone: null,
              role: sessionUser.role,
              onboarded: true,
              hasSellerProfile: false,
              isActive: true,
              isBanned: false,
            },
          }
        : null,
    isAdministratorRole: () => isAdmin,
  },
});

let route: typeof import("@/app/api/products/[id]/route");

const OWNER = "owner-user";
const OTHER = "other-user";

function seedListing(status: string) {
  const seller = seedSeller(store, { userId: OWNER });
  const category = seedCategory(store);
  return seedProduct(store, {
    sellerId: seller.id,
    ownerId: OWNER,
    categoryId: category.id,
    status,
  });
}

function patchRequest(body: unknown, origin: string | null = "http://localhost:3000") {
  const headers = new Headers({ host: "localhost:3000" });
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://localhost:3000/api/products/x", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_LISTING_BODY = {
  title: "A brand new title for editing",
  description: "A description that is definitely long enough for the validators.",
  categorySlug: "electronics",
  condition: "GOOD",
  brand: "",
  priceCents: 50_000,
  isNegotiable: false,
  quantity: 3,
  county: "Nairobi",
  town: "Kilimani",
  contactPreference: "ANY",
  images: [{ url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", cloudinaryId: "abc" }],
  status: "ACTIVE",
};

before(async () => {
  route = await import("@/app/api/products/[id]/route");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  store.operations.length = 0;
  sessionUser = null;
  isAdmin = false;
});

describe("GET /api/products/[id] — drafts are not public", () => {
  it("answers 404 to an anonymous visitor for a draft listing", async () => {
    const product = seedListing("DRAFT");
    const response = await route.GET(new NextRequest(`http://localhost/api/products/${product.id}`), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 404);
  });

  it("answers 404 to a signed-in NON-owner for a draft listing", async () => {
    const product = seedListing("DRAFT");
    sessionUser = { id: OTHER, email: "other@example.com", role: "BUYER" };

    const response = await route.GET(new NextRequest(`http://localhost/api/products/${product.id}`), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 404);
  });

  it("answers 200 to the OWNER of a draft listing", async () => {
    const product = seedListing("DRAFT");
    sessionUser = { id: OWNER, email: "owner@example.com", role: "SELLER" };

    const response = await route.GET(new NextRequest(`http://localhost/api/products/${product.id}`), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.id, product.id);
    assert.equal(payload.data.status, "DRAFT");
  });

  it("answers 200 to an administrator for a draft listing", async () => {
    const product = seedListing("ARCHIVED");
    sessionUser = { id: OTHER, email: "admin@example.com", role: "ADMIN" };
    isAdmin = true;

    const response = await route.GET(new NextRequest(`http://localhost/api/products/${product.id}`), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 200);
  });

  it("answers 200 to anyone for an ACTIVE listing", async () => {
    const product = seedListing("ACTIVE");

    const response = await route.GET(new NextRequest(`http://localhost/api/products/${product.id}`), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.title, product.title);
  });

  it("answers 404 for an id that does not exist", async () => {
    const response = await route.GET(
      new NextRequest("http://localhost/api/products/11111111-2222-4333-8444-555555555555"),
      { params: Promise.resolve({ id: "11111111-2222-4333-8444-555555555555" }) }
    );
    assert.equal(response.status, 404);
  });
});

describe("PATCH /api/products/[id] — session + origin gates", () => {
  it("rejects a cross-origin patch (CSRF) before anything else", async () => {
    const product = seedListing("ACTIVE");
    sessionUser = { id: OWNER, email: "owner@example.com", role: "SELLER" };

    const response = await route.PATCH(patchRequest(VALID_LISTING_BODY, "https://evil.example"), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 403);
    assert.equal(store.tables.products.get(product.id)!.title, product.title, "nothing changed");
  });

  it("answers 401 when unauthenticated", async () => {
    const product = seedListing("ACTIVE");
    const response = await route.PATCH(patchRequest(VALID_LISTING_BODY), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 401);
    assert.equal(store.tables.products.get(product.id)!.title, product.title);
  });

  it("answers 403 to a signed-in NON-owner and leaves the listing untouched", async () => {
    const product = seedListing("ACTIVE");
    sessionUser = { id: OTHER, email: "other@example.com", role: "SELLER" };

    const response = await route.PATCH(patchRequest(VALID_LISTING_BODY), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 403);
    assert.equal(store.tables.products.get(product.id)!.title, product.title, "title unchanged");
    assert.equal(store.tables.products.get(product.id)!.ownerId, OWNER);
  });

  it("lets the OWNER patch through to the service", async () => {
    const product = seedListing("ACTIVE");
    sessionUser = { id: OWNER, email: "owner@example.com", role: "SELLER" };

    const response = await route.PATCH(patchRequest(VALID_LISTING_BODY), {
      params: Promise.resolve({ id: product.id }),
    });
    assert.equal(response.status, 200);
    assert.equal(store.tables.products.get(product.id)!.title, VALID_LISTING_BODY.title);
  });
});

describe("DELETE /api/products/[id] — session + origin gates", () => {
  it("rejects a cross-origin delete (CSRF)", async () => {
    const product = seedListing("ACTIVE");
    sessionUser = { id: OWNER, email: "owner@example.com", role: "SELLER" };

    const headers = new Headers({ host: "localhost:3000", origin: "https://evil.example" });
    const response = await route.DELETE(
      new NextRequest(`http://localhost/api/products/${product.id}`, { method: "DELETE", headers }),
      { params: Promise.resolve({ id: product.id }) }
    );
    assert.equal(response.status, 403);
    assert.equal(store.tables.products.get(product.id)!.status, "ACTIVE");
  });

  it("answers 401 when unauthenticated", async () => {
    const product = seedListing("ACTIVE");
    const headers = new Headers({ host: "localhost:3000", origin: "http://localhost:3000" });
    const response = await route.DELETE(
      new NextRequest(`http://localhost/api/products/${product.id}`, { method: "DELETE", headers }),
      { params: Promise.resolve({ id: product.id }) }
    );
    assert.equal(response.status, 401);
    assert.equal(store.tables.products.get(product.id)!.status, "ACTIVE");
  });
  it("answers 403 to a signed-in NON-owner and keeps the listing", async () => {
    const product = seedListing("ACTIVE");
    sessionUser = { id: OTHER, email: "other@example.com", role: "SELLER" };

    const headers = new Headers({ host: "localhost:3000", origin: "http://localhost:3000" });
    const response = await route.DELETE(
      new NextRequest(`http://localhost/api/products/${product.id}`, { method: "DELETE", headers }),
      { params: Promise.resolve({ id: product.id }) }
    );
    assert.equal(response.status, 403);
    assert.equal(store.tables.products.get(product.id)!.status, "ACTIVE");
    assert.ok(store.tables.products.has(product.id), "row not deleted");
  });

  it("lets the OWNER soft-delete (status -> REMOVED)", async () => {
    const product = seedListing("ACTIVE");
    sessionUser = { id: OWNER, email: "owner@example.com", role: "SELLER" };

    const headers = new Headers({ host: "localhost:3000", origin: "http://localhost:3000" });
    const response = await route.DELETE(
      new NextRequest(`http://localhost/api/products/${product.id}`, { method: "DELETE", headers }),
      { params: Promise.resolve({ id: product.id }) }
    );
    assert.equal(response.status, 200);
    assert.equal(store.tables.products.get(product.id)!.status, "REMOVED");
  });
});
