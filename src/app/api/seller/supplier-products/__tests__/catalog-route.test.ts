import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createFakeMarketplaceStore,
  seedCategory,
  seedProduct,
  seedSeller,
  seedSupplier,
  seedSupplierProduct,
  seedUser,
  type FakeMarketplaceStore,
} from "@/services/__tests__/fake-marketplace-store";

/**
 * `GET /api/seller/supplier-products` unit and integration tests.
 *
 * Verifies:
 *  - Authentication & seller access.
 *  - Filtered retrieval (only approved suppliers and active products).
 *  - Search query (`q`), region filter (`region`), and pagination (`page`, `limit`).
 *  - Marking of already-imported listings for the authenticated seller.
 *  - Strict privacy: supplier costs (`costMinor`) and private supplier details are NEVER exposed.
 *  - Error containment.
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

let route: typeof import("@/app/api/seller/supplier-products/route");

const SELLER_USER_ID = "seller-user-001";
const OTHER_USER_ID = "other-user-002";

function request(query = ""): NextRequest {
  const url = query ? `http://localhost:3000/api/seller/supplier-products?${query}` : "http://localhost:3000/api/seller/supplier-products";
  return new NextRequest(url, {
    method: "GET",
    headers: { host: "localhost:3000" },
  });
}

before(async () => {
  route = await import("@/app/api/seller/supplier-products/route");
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
});

describe("GET /api/seller/supplier-products — authentication and access", () => {
  it("returns 401 when no session is present", async () => {
    sessionUser = null;
    const res = await route.GET(request());
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
  });

  it("returns 403 when the user account is inactive", async () => {
    sessionUser = {
      id: SELLER_USER_ID,
      email: "seller@example.com",
      isActive: false,
      isBanned: false,
      role: "SELLER",
    };
    const res = await route.GET(request());
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
  });

  it("returns 403 when the user has no seller profile in sellers table", async () => {
    sessionUser = {
      id: OTHER_USER_ID,
      email: "other@example.com",
      isActive: true,
      isBanned: false,
      role: "BUYER",
    };
    seedUser(store, { id: OTHER_USER_ID, email: "other@example.com" });
    const res = await route.GET(request());
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error, /seller setup required/i);
  });
});

describe("GET /api/seller/supplier-products — catalog filtering & privacy", () => {
  it("returns only active products from approved suppliers and excludes private fields", async () => {
    const approvedSupplier = seedSupplier(store, {
      name: "Approved Kenya Supplier",
      status: "APPROVED",
      region: "KENYA",
      contactEmail: "private-supplier@secret.com",
      contactPhone: "+254700000000",
      notes: "Confidential margin details",
    });
    const pendingSupplier = seedSupplier(store, {
      name: "Pending Supplier",
      status: "PENDING",
      region: "KENYA",
    });

    const approvedActiveProduct = seedSupplierProduct(store, {
      supplierId: approvedSupplier.id,
      title: "Solar Lantern Pro",
      costMinor: 50_000,
      isActive: true,
    });
    seedSupplierProduct(store, {
      supplierId: approvedSupplier.id,
      title: "Inactive Flashlight",
      isActive: false,
    });
    seedSupplierProduct(store, {
      supplierId: pendingSupplier.id,
      title: "Unapproved Supplier Product",
      isActive: true,
    });

    const res = await route.GET(request());
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].id, approvedActiveProduct.id);
    assert.equal(json.data[0].title, "Solar Lantern Pro");
    assert.equal(json.data[0].supplier.name, "Approved Kenya Supplier");

    // Verify strict privacy
    const raw = JSON.stringify(json);
    assert.equal(raw.includes("50000"), false, "costMinor must not leak");
    assert.equal(raw.includes("private-supplier@secret.com"), false, "contactEmail must not leak");
    assert.equal(raw.includes("+254700000000"), false, "contactPhone must not leak");
    assert.equal(raw.includes("Confidential"), false, "internal notes must not leak");
  });

  it("filters products by search query `q` across title, description, and SKU", async () => {
    const supplier = seedSupplier(store, { status: "APPROVED" });
    const p1 = seedSupplierProduct(store, {
      supplierId: supplier.id,
      title: "Leather Handbag",
      description: "Handcrafted pure leather",
      sku: "HB-001",
    });
    const p2 = seedSupplierProduct(store, {
      supplierId: supplier.id,
      title: "Ceramic Coffee Mug",
      description: "Eco-friendly mug",
      sku: "MUG-100",
    });

    // Search by title
    const resTitle = await route.GET(request("q=handbag"));
    const jsonTitle = await resTitle.json();
    assert.equal(jsonTitle.data.length, 1);
    assert.equal(jsonTitle.data[0].id, p1.id);

    // Search by description
    const resDesc = await route.GET(request("q=eco-friendly"));
    const jsonDesc = await resDesc.json();
    assert.equal(jsonDesc.data.length, 1);
    assert.equal(jsonDesc.data[0].id, p2.id);

    // Search by SKU
    const resSku = await route.GET(request("q=MUG-100"));
    const jsonSku = await resSku.json();
    assert.equal(jsonSku.data.length, 1);
    assert.equal(jsonSku.data[0].id, p2.id);
  });

  it("filters products by region (`KENYA` vs `INTERNATIONAL`)", async () => {
    const kenyaSupplier = seedSupplier(store, { status: "APPROVED", region: "KENYA" });
    const intlSupplier = seedSupplier(store, { status: "APPROVED", region: "INTERNATIONAL" });

    const pKenya = seedSupplierProduct(store, { supplierId: kenyaSupplier.id, title: "Kenyan Tea" });
    const pIntl = seedSupplierProduct(store, { supplierId: intlSupplier.id, title: "Imported Watch" });

    const resKenya = await route.GET(request("region=KENYA"));
    const jsonKenya = await resKenya.json();
    assert.equal(jsonKenya.data.length, 1);
    assert.equal(jsonKenya.data[0].id, pKenya.id);

    const resIntl = await route.GET(request("region=INTERNATIONAL"));
    const jsonIntl = await resIntl.json();
    assert.equal(jsonIntl.data.length, 1);
    assert.equal(jsonIntl.data[0].id, pIntl.id);
  });

  it("paginates results accurately", async () => {
    const supplier = seedSupplier(store, { status: "APPROVED" });
    for (let i = 1; i <= 5; i++) {
      seedSupplierProduct(store, { supplierId: supplier.id, title: `Product Item ${i}` });
    }

    const resPage1 = await route.GET(request("page=1&limit=2"));
    const json1 = await resPage1.json();
    assert.equal(json1.data.length, 2);
    assert.equal(json1.pagination.page, 1);
    assert.equal(json1.pagination.limit, 2);
    assert.equal(json1.pagination.total, 5);
    assert.equal(json1.pagination.totalPages, 3);

    const resPage2 = await route.GET(request("page=2&limit=2"));
    const json2 = await resPage2.json();
    assert.equal(json2.data.length, 2);
    assert.equal(json2.pagination.page, 2);

    const resPage3 = await route.GET(request("page=3&limit=2"));
    const json3 = await resPage3.json();
    assert.equal(json3.data.length, 1);
  });

  it("marks `importedListing` when the seller has already imported that product", async () => {
    const seller = store.tables.sellers.get([...store.tables.sellers.keys()][0]!)!;
    const category = seedCategory(store, { name: "Electronics", slug: "electronics" });
    const supplier = seedSupplier(store, { status: "APPROVED" });

    const pImported = seedSupplierProduct(store, { supplierId: supplier.id, title: "Imported Phone Case" });
    const pNotImported = seedSupplierProduct(store, { supplierId: supplier.id, title: "Unimported Charger" });

    const listing = seedProduct(store, {
      sellerId: seller.id,
      ownerId: SELLER_USER_ID,
      categoryId: category.id,
      supplierProductId: pImported.id,
      title: "Imported Phone Case",
      status: "DRAFT",
    });

    const res = await route.GET(request());
    const json = await res.json();

    const item1 = json.data.find((item: { id: string }) => item.id === pImported.id);
    const item2 = json.data.find((item: { id: string }) => item.id === pNotImported.id);

    assert.ok(item1?.importedListing);
    assert.equal(item1.importedListing.id, listing.id);
    assert.equal(item1.importedListing.status, "DRAFT");
    assert.equal(item2?.importedListing, null);
  });
});

describe("GET /api/seller/supplier-products — error containment", () => {
  it("does not leak database error details on unexpected server exceptions", async () => {
    const originalFindMany = store.supplierProduct.findMany;
    store.supplierProduct.findMany = async () => {
      throw new Error("connection to postgres://user:secret@localhost failed: table does not exist");
    };

    try {
      const res = await route.GET(request());
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.equal(text.includes("postgres://"), false);
      assert.equal(text.includes("secret"), false);
      const json = JSON.parse(text);
      assert.equal(json.success, false);
      assert.match(json.error, /unable to load/i);
    } finally {
      store.supplierProduct.findMany = originalFindMany;
    }
  });
});
