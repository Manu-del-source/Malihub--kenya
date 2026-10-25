import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * Supplier governance API tests: admin-only onboarding/approval, product
 * review, manual stock verification, seller catalog confidentiality and the
 * verified-seller-only pricing preview.
 *
 * A small in-memory store stands in for Prisma. Every route is imported after
 * the module mocks are installed, so auth/CSRF/DB boundaries are the real ones.
 */

type Row = Record<string, unknown>;
type SessionUser = { id: string; email: string; role: string; isActive: boolean; isBanned: boolean } | null;

let sessionUser: SessionUser = null;
const ORIGIN = "https://malihub.test";

// Non-secret server configuration for deterministic pricing assertions.
process.env.DROPSHIPPING_PAYMENT_FEE_BPS = "150";
process.env.DROPSHIPPING_TAX_BPS = "0";
process.env.DROPSHIPPING_FEE_CONFIG_VERIFIED = "true";

const rows = {
  suppliers: new Map<string, Row>(),
  supplierProducts: new Map<string, Row>(),
  verifications: [] as Row[],
  listingCosts: new Map<string, Row>(),
  commissionRules: [] as Row[],
  sellers: new Map<string, Row>(),
  categories: new Map<string, Row>(),
  products: new Map<string, Row>(),
  auditLogs: [] as Row[],
};

function reset() {
  for (const map of [
    rows.suppliers, rows.supplierProducts, rows.listingCosts,
    rows.sellers, rows.categories, rows.products,
  ]) map.clear();
  rows.verifications.length = 0;
  rows.commissionRules.length = 0;
  rows.auditLogs.length = 0;
  sessionUser = null;
}

const matchesWhere = (row: Row, where: Row = {}) => {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === "OR" && Array.isArray(value)) {
      const any = value.some((clause: Row) => matchesWhere(row, clause));
      if (!any) return false;
      continue;
    }
    if (key === "supplier" && value && typeof value === "object") {
      const supplier = rows.suppliers.get(String(row.supplierId));
      if (!supplier || !matchesWhere(supplier, value as Row)) return false;
      continue;
    }
    if (value && typeof value === "object" && "contains" in value) {
      const needle = String((value as Row).contains).toLowerCase();
      if (!String(row[key] ?? "").toLowerCase().includes(needle)) return false;
      continue;
    }
    if (value && typeof value === "object" && "not" in value) {
      if (row[key] === (value as Row).not) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
};

const withSupplier = (row: Row) => ({
  ...row,
  supplier: rows.suppliers.get(String(row.supplierId)) ?? null,
});

/** Honour Prisma `select` so confidentiality assertions are meaningful. */
function project(row: Row, select?: Row): Row {
  if (!select) return row;
  const result: Row = {};
  for (const [key, value] of Object.entries(select)) {
    if (value === true) result[key] = row[key];
    else if (value && typeof value === "object" && "select" in value) {
      result[key] = project((row[key] as Row) ?? {}, (value as Row).select as Row);
    }
  }
  return result;
}

type TransactionClient = { [delegate: string]: unknown };

const prisma = {
  supplier: {
    async findUnique({ where }: { where: Row }) {
      return rows.suppliers.get(String(where.id)) ?? null;
    },
    async findFirst({ where }: { where?: Row } = {}) {
      return [...rows.suppliers.values()].find((r) => matchesWhere(r, where)) ?? null;
    },
    async findMany({ where, skip = 0, take = 50 }: { where?: Row; skip?: number; take?: number } = {}) {
      return [...rows.suppliers.values()].filter((r) => matchesWhere(r, where)).slice(skip, skip + take);
    },
    async count({ where }: { where?: Row } = {}) {
      return [...rows.suppliers.values()].filter((r) => matchesWhere(r, where)).length;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.suppliers.set(String(row.id), row);
      return row;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = rows.suppliers.get(String(where.id));
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const row = rows.suppliers.get(String(where.id));
      if (!row || !matchesWhere(row, where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  supplierProduct: {
    async findUnique({ where, select }: { where: Row; select?: Row }) {
      const row = rows.supplierProducts.get(String(where.id));
      return row ? project(withSupplier(row), select) : null;
    },
    async findFirst({ where, select }: { where?: Row; select?: Row } = {}) {
      const row = [...rows.supplierProducts.values()].find((r) => matchesWhere(r, where));
      return row ? project(withSupplier(row), select) : null;
    },
    async findMany({ where, skip = 0, take = 50, select }: { where?: Row; skip?: number; take?: number; select?: Row } = {}) {
      return [...rows.supplierProducts.values()]
        .filter((r) => matchesWhere(r, where))
        .slice(skip, skip + take)
        .map((r) => project(withSupplier(r), select));
    },
    async count({ where }: { where?: Row } = {}) {
      return [...rows.supplierProducts.values()].filter((r) => matchesWhere(r, where)).length;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.supplierProducts.set(String(row.id), row);
      return row;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = rows.supplierProducts.get(String(where.id));
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data, { updatedAt: new Date() });
      return withSupplier(row);
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const row = rows.supplierProducts.get(String(where.id));
      if (!row || !matchesWhere(row, where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  supplierProductVerification: {
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), ...data };
      rows.verifications.push(row);
      return row;
    },
  },
  supplierListingCost: {
    async findMany({ where }: { where?: Row } = {}) {
      return [...rows.listingCosts.values()].filter((r) => matchesWhere(r, where));
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = rows.listingCosts.get(String(where.productId));
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data);
      return row;
    },
    async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
      const id = String(where.productId ?? create.productId);
      const existing = rows.listingCosts.get(id);
      const row = { ...(existing ?? create), ...(existing ? update : {}) };
      rows.listingCosts.set(id, row);
      return row;
    },
  },
  commissionRule: {
    async findMany() {
      return rows.commissionRules;
    },
  },
  category: {
    async findUnique({ where }: { where: Row }) {
      return [...rows.categories.values()].find((r) => r.slug === where.slug) ?? null;
    },
  },
  seller: {
    async findUnique({ where }: { where: Row }) {
      return [...rows.sellers.values()].find((r) => r.userId === where.userId) ?? null;
    },
  },
  product: {
    async findMany({ where }: { where?: Row } = {}) {
      return [...rows.products.values()].filter((r) => matchesWhere(r, where));
    },
    async findFirst({ where }: { where?: Row } = {}) {
      return [...rows.products.values()].find((r) => matchesWhere(r, where)) ?? null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), ...data };
      rows.products.set(String(row.id), row);
      return row;
    },
  },
  auditLog: {
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), ...data };
      rows.auditLogs.push(row);
      return row;
    },
  },
  async $transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return callback(prisma as unknown as TransactionClient);
  },
};

const prismaProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, property: string) => (prisma as unknown as Record<string, unknown>)[property],
});

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser
        ? {
            identity: { authUserId: `neon-${sessionUser.id}` },
            user: { ...sessionUser, hasSellerProfile: true },
          }
        : null,
    isAdministratorRole: (role: string) => role === "ADMIN" || role === "SUPER_ADMIN",
  },
});

let adminSuppliers: typeof import("@/app/api/admin/suppliers/route");
let adminSupplierById: typeof import("@/app/api/admin/suppliers/[id]/route");
let adminSupplierProducts: typeof import("@/app/api/admin/suppliers/[id]/products/route");
let adminProductDecision: typeof import("@/app/api/admin/supplier-products/[id]/route");
let adminVerify: typeof import("@/app/api/admin/supplier-products/[id]/verify/route");
let sellerCatalog: typeof import("@/app/api/seller/supplier-products/route");
let sellerPricing: typeof import("@/app/api/seller/supplier-products/[id]/pricing-preview/route");

const ADMIN_USER = { id: randomUUID(), email: "admin@malihub.test", role: "ADMIN", isActive: true, isBanned: false };
const BUYER_USER = { id: randomUUID(), email: "buyer@malihub.test", role: "BUYER", isActive: true, isBanned: false };
const SELLER_USER = { id: randomUUID(), email: "seller@malihub.test", role: "SELLER", isActive: true, isBanned: false };
const UNVERIFIED_USER = { id: randomUUID(), email: "pending@malihub.test", role: "SELLER", isActive: true, isBanned: false };

function req(method: string, path: string, body?: unknown, crossOrigin = false): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: "malihub.test",
      origin: crossOrigin ? "https://evil.example" : ORIGIN,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function supplierPayload(overrides: Row = {}) {
  return {
    name: "Nairobi Verified Supplies",
    slug: "nairobi-verified-supplies",
    region: "KENYA",
    countryCode: "KE",
    legalName: "Nairobi Verified Supplies Ltd",
    registrationNumber: "PVT-2026-001",
    contactName: "Operations Desk",
    contactEmail: "ops@supplier.test",
    contactPhone: "+254700000001",
    deliveryCounties: ["Nairobi", "Kiambu"],
    returnTerms: "Defective items accepted within 7 days.",
    paymentTerms: "Prepaid by seller before dispatch.",
    paymentResponsibility: "SELLER",
    verificationNotes: "Business registration checked manually.",
    ...overrides,
  };
}

async function createApprovedSupplier() {
  const created = await adminSuppliers.POST(req("POST", "/api/admin/suppliers", supplierPayload()));
  assert.equal(created.status, 201);
  const supplier = (await created.json()).data as Row;
  const terms = await adminSupplierById.PUT(
    req("PUT", `/api/admin/suppliers/${supplier.id}`, {
      legalName: "Nairobi Verified Supplies Ltd",
      registrationNumber: "PVT-2026-001",
      contactEmail: "ops@supplier.test",
      contactPhone: "+254700000001",
      deliveryCounties: ["Nairobi"],
      returnTerms: "Defective items accepted within 7 days.",
      paymentTerms: "Prepaid by seller before dispatch.",
      paymentResponsibility: "SELLER",
      commercialTermsVerified: true,
    }),
    params(String(supplier.id)),
  );
  assert.equal(terms.status, 200);
  const approved = await adminSupplierById.PATCH(
    req("PATCH", `/api/admin/suppliers/${supplier.id}`, { status: "APPROVED", reason: "Manual business verification complete." }),
    params(String(supplier.id)),
  );
  assert.equal(approved.status, 200);
  return String(supplier.id);
}

before(async () => {
  adminSuppliers = await import("@/app/api/admin/suppliers/route");
  adminSupplierById = await import("@/app/api/admin/suppliers/[id]/route");
  adminSupplierProducts = await import("@/app/api/admin/suppliers/[id]/products/route");
  adminProductDecision = await import("@/app/api/admin/supplier-products/[id]/route");
  adminVerify = await import("@/app/api/admin/supplier-products/[id]/verify/route");
  sellerCatalog = await import("@/app/api/seller/supplier-products/route");
  sellerPricing = await import("@/app/api/seller/supplier-products/[id]/pricing-preview/route");
});

beforeEach(reset);

describe("admin supplier onboarding and approval", () => {
  it("rejects unauthenticated, non-admin and cross-origin requests", async () => {
    sessionUser = null;
    const unauthenticated = await adminSuppliers.POST(req("POST", "/api/admin/suppliers", supplierPayload()));
    assert.equal(unauthenticated.status, 401);

    sessionUser = BUYER_USER;
    const forbidden = await adminSuppliers.POST(req("POST", "/api/admin/suppliers", supplierPayload()));
    assert.equal(forbidden.status, 403);

    sessionUser = ADMIN_USER;
    const csrf = await adminSuppliers.POST(req("POST", "/api/admin/suppliers", supplierPayload(), true));
    assert.equal(csrf.status, 403);
    assert.equal(rows.suppliers.size, 0);
    assert.equal(rows.auditLogs.length, 0);
  });

  it("creates only PENDING suppliers and records an audit trail", async () => {
    sessionUser = ADMIN_USER;
    const res = await adminSuppliers.POST(req("POST", "/api/admin/suppliers", supplierPayload()));
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.status, "PENDING");
    assert.equal(rows.suppliers.size, 1);
    assert.ok(rows.auditLogs.some((row) => row.action === "supplier.created"));
  });

  it("refuses approval before manual business/commercial verification", async () => {
    sessionUser = ADMIN_USER;
    const created = await adminSuppliers.POST(
      req("POST", "/api/admin/suppliers", supplierPayload({ legalName: undefined, registrationNumber: undefined, contactEmail: "", contactPhone: "" })),
    );
    const id = String((await created.json()).data.id);
    const denied = await adminSupplierById.PATCH(
      req("PATCH", `/api/admin/suppliers/${id}`, { status: "APPROVED", reason: "Looks legitimate." }),
      params(id),
    );
    assert.equal(denied.status, 422);
    assert.match((await denied.json()).error, /verification/i);

    const terms = await adminSupplierById.PUT(
      req("PUT", `/api/admin/suppliers/${id}`, {
        legalName: "Nairobi Verified Supplies Ltd",
        registrationNumber: "PVT-2026-001",
        contactEmail: "ops@supplier.test",
        contactPhone: "+254700000001",
        deliveryCounties: ["Nairobi"],
        returnTerms: "Defective items accepted within 7 days.",
        paymentTerms: "Prepaid by seller before dispatch.",
        paymentResponsibility: "SELLER",
        commercialTermsVerified: true,
      }),
      params(id),
    );
    assert.equal(terms.status, 200);
    const approved = await adminSupplierById.PATCH(
      req("PATCH", `/api/admin/suppliers/${id}`, { status: "APPROVED", reason: "Manual business verification complete." }),
      params(id),
    );
    assert.equal(approved.status, 200);
    assert.ok(rows.auditLogs.some((row) => row.action === "supplier.status_changed"));
  });
});

describe("supplier product review and stock verification", () => {
  it("submits products as PENDING_REVIEW and never approves them automatically", async () => {
    sessionUser = ADMIN_USER;
    const supplierId = await createApprovedSupplier();
    const res = await adminSupplierProducts.POST(
      req("POST", `/api/admin/suppliers/${supplierId}/products`, {
        title: "Solar Lantern",
        sku: "SL-001",
        costMinor: 150000,
        currency: "KES",
        deliveryChargeMinor: 5000,
        availableQuantity: 20,
        submitForReview: true,
      }),
      params(supplierId),
    );
    assert.equal(res.status, 201);
    const product = (await res.json()).data as Row;
    assert.equal(product.approvalStatus, "PENDING_REVIEW");
    assert.equal(rows.supplierProducts.size, 1);
    assert.ok(rows.auditLogs.some((row) => row.action === "supplier_product.submitted"));
  });

  it("requires verification before approval, then exposes only approved products to sellers", async () => {
    sessionUser = ADMIN_USER;
    const supplierId = await createApprovedSupplier();
    const created = await adminSupplierProducts.POST(
      req("POST", `/api/admin/suppliers/${supplierId}/products`, {
        title: "Solar Lantern", sku: "SL-001", costMinor: 150000, currency: "KES",
      }),
      params(supplierId),
    );
    const id = String((await created.json()).data.id);

    const premature = await adminProductDecision.PATCH(
      req("PATCH", `/api/admin/supplier-products/${id}`, { decision: "APPROVE", note: "Looks good." }),
      params(id),
    );
    assert.equal(premature.status, 422);

    const verification = await adminVerify.POST(
      req("POST", `/api/admin/supplier-products/${id}/verify`, {
        stockStatus: "IN_STOCK",
        availableQuantity: 20,
        costMinor: 150000,
        deliveryChargeMinor: 5000,
        method: "MANUAL",
        note: "Confirmed with supplier by phone.",
        sourceReference: "CALL-2026-10-25",
      }),
      params(id),
    );
    assert.equal(verification.status, 200);
    assert.equal(rows.verifications.length, 1);
    const product = rows.supplierProducts.get(id)!;
    assert.equal(product.stockVerifiedAt instanceof Date, true);
    assert.equal(product.costStatus, "CONFIRMED");
    assert.equal(product.manualRefreshRequired, false);

    const approved = await adminProductDecision.PATCH(
      req("PATCH", `/api/admin/supplier-products/${id}`, { decision: "APPROVE", note: "Verified and approved." }),
      params(id),
    );
    assert.equal(approved.status, 200);
    assert.equal(rows.supplierProducts.get(id)?.approvalStatus, "APPROVED");

    // Seller sees the approved item with a freshness classification, but not
    // the supplier cost, delivery charge, contact data or review note.
    rows.sellers.set("seller-1", { id: "seller-1", userId: SELLER_USER.id, verificationStatus: "VERIFIED" });
    sessionUser = SELLER_USER;
    const catalog = await sellerCatalog.GET(req("GET", "/api/seller/supplier-products"));
    assert.equal(catalog.status, 200);
    const raw = await catalog.text();
    assert.equal(raw.includes("costMinor"), false);
    assert.equal(raw.includes("deliveryChargeMinor"), false);
    assert.equal(raw.includes("contactEmail"), false);
    assert.equal(raw.includes("reviewNote"), false);
    assert.equal(raw.includes("ops@supplier.test"), false);
    assert.equal(raw.includes("Verified and approved."), false);
    const json = JSON.parse(raw);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].availability.isGuaranteed, false);
    assert.equal(json.data[0].availability.isSnapshot, true);
  });

  it("rejects unverified supplier API methods with an explicit 501", async () => {
    sessionUser = ADMIN_USER;
    const supplierId = await createApprovedSupplier();
    const created = await adminSupplierProducts.POST(
      req("POST", `/api/admin/suppliers/${supplierId}/products`, { title: "Feed Item", costMinor: 1000, currency: "KES" }),
      params(supplierId),
    );
    const id = String((await created.json()).data.id);
    const res = await adminVerify.POST(
      req("POST", `/api/admin/supplier-products/${id}/verify`, {
        stockStatus: "IN_STOCK",
        availableQuantity: 5,
        costMinor: 1000,
        deliveryChargeMinor: 0,
        method: "SUPPLIER_API",
        note: "Would be fetched from an unconfigured feed.",
      }),
      params(id),
    );
    assert.equal(res.status, 501);
    assert.equal(rows.verifications.length, 0);
  });

  it("suspends an approved product so it disappears from the seller catalog", async () => {
    sessionUser = ADMIN_USER;
    const supplierId = await createApprovedSupplier();
    const created = await adminSupplierProducts.POST(
      req("POST", `/api/admin/suppliers/${supplierId}/products`, { title: "Lantern", costMinor: 1000, currency: "KES" }),
      params(supplierId),
    );
    const id = String((await created.json()).data.id);
    await adminVerify.POST(
      req("POST", `/api/admin/supplier-products/${id}/verify`, {
        stockStatus: "IN_STOCK", availableQuantity: 5, costMinor: 1000,
        deliveryChargeMinor: 0, method: "MANUAL", note: "Verified by supplier email.",
      }),
      params(id),
    );
    await adminProductDecision.PATCH(
      req("PATCH", `/api/admin/supplier-products/${id}`, { decision: "APPROVE", note: "Verified and approved." }),
      params(id),
    );
    const suspended = await adminProductDecision.PATCH(
      req("PATCH", `/api/admin/supplier-products/${id}`, { decision: "SUSPEND", note: "Repeated late dispatch." }),
      params(id),
    );
    assert.equal(suspended.status, 200);
    assert.equal(rows.supplierProducts.get(id)?.approvalStatus, "SUSPENDED");

    rows.sellers.set("seller-1", { id: "seller-1", userId: SELLER_USER.id, verificationStatus: "VERIFIED" });
    sessionUser = SELLER_USER;
    const catalog = await sellerCatalog.GET(req("GET", "/api/seller/supplier-products"));
    assert.equal((await catalog.json()).data.length, 0);
  });
});

describe("seller pricing preview confidentiality", () => {
  it("is available only to verified sellers and returns derived estimates, not supplier cost", async () => {
    sessionUser = ADMIN_USER;
    const supplierId = await createApprovedSupplier();
    const created = await adminSupplierProducts.POST(
      req("POST", `/api/admin/suppliers/${supplierId}/products`, { title: "Lantern", costMinor: 150000, currency: "KES", deliveryChargeMinor: 5000 }),
      params(supplierId),
    );
    const id = String((await created.json()).data.id);
    await adminVerify.POST(
      req("POST", `/api/admin/supplier-products/${id}/verify`, {
        stockStatus: "IN_STOCK", availableQuantity: 5, costMinor: 150000,
        deliveryChargeMinor: 5000, method: "MANUAL", note: "Verified by supplier email.",
      }),
      params(id),
    );
    await adminProductDecision.PATCH(
      req("PATCH", `/api/admin/supplier-products/${id}`, { decision: "APPROVE", note: "Verified and approved." }),
      params(id),
    );
    rows.categories.set("cat-1", { id: "cat-1", slug: "electronics", name: "Electronics" });
    rows.commissionRules.push({ id: "rule-1", scope: "DEFAULT", type: "PERCENTAGE", percentageBps: 500, isActive: true });
    rows.sellers.set("seller-1", { id: "seller-1", userId: SELLER_USER.id, verificationStatus: "VERIFIED" });
    rows.sellers.set("seller-2", { id: "seller-2", userId: UNVERIFIED_USER.id, verificationStatus: "PENDING" });

    sessionUser = BUYER_USER;
    const buyer = await sellerPricing.POST(
      req("POST", `/api/seller/supplier-products/${id}/pricing-preview`, { priceCents: 250000 }),
      params(id),
    );
    assert.equal(buyer.status, 403);

    sessionUser = UNVERIFIED_USER;
    const unverified = await sellerPricing.POST(
      req("POST", `/api/seller/supplier-products/${id}/pricing-preview`, { priceCents: 250000 }),
      params(id),
    );
    assert.equal(unverified.status, 403);

    sessionUser = SELLER_USER;
    const crossOrigin = await sellerPricing.POST(
      req("POST", `/api/seller/supplier-products/${id}/pricing-preview`, { priceCents: 250000 }, true),
      params(id),
    );
    assert.equal(crossOrigin.status, 403);

    const res = await sellerPricing.POST(
      req("POST", `/api/seller/supplier-products/${id}/pricing-preview`, {
        categorySlug: "electronics", priceCents: 250000, sellerFulfilmentCostCents: 2000,
      }),
      params(id),
    );
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.equal(raw.includes("supplierCostCents"), false);
    assert.equal(raw.includes("supplierDeliveryCents"), false);
    const json = JSON.parse(raw);
    assert.equal(json.data.estimatedGrossProfitCents, 76750);
    assert.equal(json.data.marginBps, 3070);
    assert.equal(typeof json.data.isEstimate, "boolean");
  });
});
