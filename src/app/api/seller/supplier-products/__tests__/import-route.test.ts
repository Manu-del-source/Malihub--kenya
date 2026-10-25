import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createFakeMarketplaceStore,
  seedCategory,
  seedSeller,
  seedSupplier,
  seedSupplierProduct,
  seedUser,
  type FakeMarketplaceStore,
} from "@/services/__tests__/fake-marketplace-store";

/**
 * `POST /api/seller/supplier-products/[id]/import` unit and integration tests.
 *
 * Verifies:
 *  - Authentication & access control (signed-in, active, unbanned, verified seller).
 *  - CSRF / same-origin protection.
 *  - Input validation (category, Kenyan counties, price bounds, town, quantity).
 *  - Supplier product and supplier status validation (active, approved supplier only).
 *  - Safe draft creation (status DRAFT, publishedAt null, unique slug, supplier attribution).
 *  - Privacy (supplier costMinor, email, phone, notes are strictly never exposed).
 *  - Duplicate import prevention (application check and database P2002 unique constraint).
 *  - Safe error containment.
 */

const store: FakeMarketplaceStore = createFakeMarketplaceStore();

type SessionUser = {
  id: string;
  email: string;
  isActive: boolean;
  isBanned: boolean;
  role: string;
} | null;

let sessionUser: SessionUser = null;

const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => (store as unknown as Record<string, unknown>)[property],
});

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser
        ? {
            identity: { authUserId: "neon-seller-1" },
            user: {
              id: sessionUser.id,
              email: sessionUser.email,
              isActive: sessionUser.isActive,
              isBanned: sessionUser.isBanned,
              role: sessionUser.role,
              hasSellerProfile: true,
            },
          }
        : null,
    isAdministratorRole: () => false,
  },
});

let route: typeof import("@/app/api/seller/supplier-products/[id]/import/route");

const SELLER_USER_ID = "seller-user-001";
const OTHER_USER_ID = "other-user-002";

function request(
  supplierProductId: string,
  body?: unknown,
  { origin = "http://localhost:3000", host = "localhost:3000" }: { origin?: string | null; host?: string } = {}
): NextRequest {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost:3000/api/seller/supplier-products/${supplierProductId}/import`, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

const validPayload = {
  categorySlug: "electronics",
  priceCents: 250_000,
  county: "Nairobi",
  town: "Westlands",
  quantity: 2,
};

before(async () => {
  route = await import("@/app/api/seller/supplier-products/[id]/import/route");
});

beforeEach(() => {
  for (const table of Object.values(store.tables)) table.clear();
  sessionUser = {
    id: SELLER_USER_ID,
    email: "seller@example.com",
    isActive: true,
    isBanned: false,
    role: "SELLER",
  };
  seedUser(store, { id: SELLER_USER_ID, email: "seller@example.com", role: "SELLER" });
  seedSeller(store, { userId: SELLER_USER_ID, verificationStatus: "VERIFIED" });
  seedCategory(store, { name: "Electronics", slug: "electronics" });
});

describe("POST /api/seller/supplier-products/[id]/import — authentication and authorization", () => {
  it("returns 401 when no session exists", async () => {
    sessionUser = null;
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /sign in required/i);
  });

  it("returns 403 when the user account is inactive", async () => {
    sessionUser = {
      id: SELLER_USER_ID,
      email: "seller@example.com",
      isActive: false,
      isBanned: false,
      role: "SELLER",
    };
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /access denied/i);
  });

  it("returns 403 when the user account is banned", async () => {
    sessionUser = {
      id: SELLER_USER_ID,
      email: "seller@example.com",
      isActive: true,
      isBanned: true,
      role: "SELLER",
    };
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /access denied/i);
  });

  it("returns 403 when user has no seller profile in sellers table", async () => {
    sessionUser = {
      id: OTHER_USER_ID,
      email: "other@example.com",
      isActive: true,
      isBanned: false,
      role: "BUYER",
    };
    seedUser(store, { id: OTHER_USER_ID, email: "other@example.com" });
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /seller setup required/i);
  });

  it("returns 403 when seller verification is PENDING", async () => {
    store.tables.sellers.clear();
    seedSeller(store, { userId: SELLER_USER_ID, verificationStatus: "PENDING" });
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /verification is required/i);
  });

  it("returns 403 when seller verification is REJECTED", async () => {
    store.tables.sellers.clear();
    seedSeller(store, { userId: SELLER_USER_ID, verificationStatus: "REJECTED" });
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /verification is required/i);
  });

  it("rejects cross-origin requests with 403", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, validPayload, { origin: "https://attacker.example.com" }),
      context(item.id)
    );
    assert.equal(res.status, 403);
  });
});

describe("POST /api/seller/supplier-products/[id]/import — input validation", () => {
  it("returns 400 on malformed JSON body", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const req = new NextRequest(`http://localhost:3000/api/seller/supplier-products/${item.id}/import`, {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
      body: "invalid-json{",
    });

    const res = await route.POST(req, context(item.id));
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
  });

  it("returns 400 when categorySlug format is invalid", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, { ...validPayload, categorySlug: "Invalid Category Slug!@#" }),
      context(item.id)
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.fieldErrors?.categorySlug);
  });

  it("returns 400 when category does not exist in the database", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, { ...validPayload, categorySlug: "nonexistent-category" }),
      context(item.id)
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /valid category/i);
  });

  it("returns 400 when county is not a supported Kenyan county", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, { ...validPayload, county: "London" }),
      context(item.id)
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.fieldErrors?.county);
  });

  it("returns 400 when price is zero or negative", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, { ...validPayload, priceCents: 0 }),
      context(item.id)
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.fieldErrors?.priceCents);
  });

  it("returns 400 when town is empty or too short", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, { ...validPayload, town: "a" }),
      context(item.id)
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.fieldErrors?.town);
  });

  it("returns 400 when quantity is less than 1", async () => {
    const supplier = seedSupplier(store);
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const res = await route.POST(
      request(item.id, { ...validPayload, quantity: 0 }),
      context(item.id)
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.ok(json.fieldErrors?.quantity);
  });
});

describe("POST /api/seller/supplier-products/[id]/import — supplier product availability", () => {
  it("returns 404 when supplier product ID does not exist", async () => {
    const res = await route.POST(
      request("nonexistent-supplier-product-id", validPayload),
      context("nonexistent-supplier-product-id")
    );
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /unavailable/i);
  });

  it("returns 404 when supplier product is marked inactive", async () => {
    const supplier = seedSupplier(store, { status: "APPROVED" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id, isActive: false });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /unavailable/i);
  });

  it("returns 404 when supplier status is PENDING", async () => {
    const supplier = seedSupplier(store, { status: "PENDING" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id, isActive: true });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /not approved/i);
  });

  it("returns 404 when supplier status is REJECTED", async () => {
    const supplier = seedSupplier(store, { status: "REJECTED" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id, isActive: true });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
  });

  it("returns 404 when supplier status is SUSPENDED", async () => {
    const supplier = seedSupplier(store, { status: "SUSPENDED" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id, isActive: true });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.success, false);
  });
});

describe("POST /api/seller/supplier-products/[id]/import — successful draft import & privacy", () => {
  it("imports supplier product as a DRAFT and never exposes supplier cost", async () => {
    const supplier = seedSupplier(store, {
      name: "Top Tier Suppliers KE",
      status: "APPROVED",
      contactEmail: "secret-supplier@example.com",
      contactPhone: "+254711223344",
      notes: "Internal supplier cost is confidential",
    });
    const item = seedSupplierProduct(store, {
      supplierId: supplier.id,
      title: "Premium Wireless Earbuds",
      description: "Noise cancelling Bluetooth 5.3 earbuds.",
      costMinor: 80_000, // 800 KES cost
      currency: "KES",
      isActive: true,
    });

    const res = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(res.status, 201);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.ok(json.data.id);
    assert.equal(json.data.status, "DRAFT", "must always be created as DRAFT");
    assert.equal(json.data.priceCents, 250_000, "retail price matches seller input");
    assert.ok(json.data.slug.startsWith("premium-wireless-earbuds"));

    // Check DB record directly
    const created = store.tables.products.get(json.data.id);
    assert.ok(created);
    assert.equal(created.status, "DRAFT");
    assert.equal(created.publishedAt, null, "publishedAt must be null");
    assert.equal(created.supplierProductId, item.id);
    assert.equal(created.ownerId, SELLER_USER_ID);
    assert.equal(created.county, "Nairobi");
    assert.equal(created.subCounty, "Westlands");
    assert.equal(created.quantity, 2);
    assert.match(created.description, /Top Tier Suppliers KE/);
    assert.match(created.description, /Verify product details/);

    // Verify no supplier cost or secrets leaked in response
    const rawResponse = JSON.stringify(json);
    assert.equal(rawResponse.includes("80000"), false, "supplier costMinor must not leak");
    assert.equal(rawResponse.includes("secret-supplier@example.com"), false, "supplier email must not leak");
    assert.equal(rawResponse.includes("+254711223344"), false, "supplier phone must not leak");
    assert.equal(rawResponse.includes("confidential"), false, "supplier notes must not leak");
  });
});

describe("POST /api/seller/supplier-products/[id]/import — duplicate & concurrency protection", () => {
  it("returns 409 when the seller already imported the supplier product (application check)", async () => {
    const supplier = seedSupplier(store, { status: "APPROVED" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    // First import succeeds
    const firstRes = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(firstRes.status, 201);

    // Second import fails with 409
    const secondRes = await route.POST(request(item.id, validPayload), context(item.id));
    assert.equal(secondRes.status, 409);
    const json = await secondRes.json();
    assert.equal(json.success, false);
    assert.match(json.error, /already imported/i);
    assert.ok(json.data?.id, "returns existing product info");
  });

  it("handles concurrent P2002 unique constraint violations and returns 409", async () => {
    const supplier = seedSupplier(store, { status: "APPROVED" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    // Mock prisma.product.create to throw P2002 (simulating concurrent insert race)
    const originalCreate = store.product.create;
    let thrown = false;
    store.product.create = async () => {
      thrown = true;
      const { PrismaKnownError } = await import("@/services/__tests__/fake-account-store");
      throw new PrismaKnownError(
        "P2002",
        "Unique constraint failed on the fields: (seller_id, supplier_product_id)"
      );
    };

    try {
      const res = await route.POST(request(item.id, validPayload), context(item.id));
      assert.equal(thrown, true);
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error, /already imported/i);
    } finally {
      store.product.create = originalCreate;
    }
  });
});

describe("POST /api/seller/supplier-products/[id]/import — error containment", () => {
  it("does not leak database error details on unexpected exceptions", async () => {
    const supplier = seedSupplier(store, { status: "APPROVED" });
    const item = seedSupplierProduct(store, { supplierId: supplier.id });

    const originalFindFirst = store.supplierProduct.findFirst;
    store.supplierProduct.findFirst = async () => {
      throw new Error("FATAL: postgres://user:secretpw@prod-db.internal:5432 connection crashed");
    };

    try {
      const res = await route.POST(request(item.id, validPayload), context(item.id));
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.equal(text.includes("secretpw"), false);
      assert.equal(text.includes("prod-db.internal"), false);
      assert.equal(text.includes("FATAL"), false);
      const json = JSON.parse(text);
      assert.equal(json.success, false);
      assert.match(json.error, /unable to import/i);
    } finally {
      store.supplierProduct.findFirst = originalFindFirst;
    }
  });
});
