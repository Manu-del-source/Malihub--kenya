import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Service-level tests for the supplier order lifecycle:
 *  - verified-payment fan-out is idempotent per order item;
 *  - valid/invalid fulfilment transitions, ownership and delivery evidence;
 *  - purchase idempotency and no automatic payment;
 *  - return/dispute payout holds, refund idempotency and resolution rules.
 *
 * The in-memory store enforces the unique keys that the real migration adds.
 */

type Row = Record<string, unknown>;
type Where = Row;

class PrismaKnownError extends Error {
  readonly code = "P2002";
  constructor(message: string) {
    super(message);
    this.name = "PrismaKnownError";
  }
}

const dbRows = {
  users: new Map<string, Row>(),
  sellers: new Map<string, Row>(),
  suppliers: new Map<string, Row>(),
  supplierProducts: new Map<string, Row>(),
  orders: new Map<string, Row>(),
  orderItems: new Map<string, Row>(),
  products: new Map<string, Row>(),
  payments: new Map<string, Row>(),
  shipments: new Map<string, Row>(),
  fulfilments: new Map<string, Row>(),
  events: new Map<string, Row>(),
  purchases: new Map<string, Row>(),
  returns: new Map<string, Row>(),
  cases: new Map<string, Row>(),
  refunds: new Map<string, Row>(),
};

const auditLogs: Row[] = [];
const notifications: Row[] = [];

function resetDb() {
  for (const map of Object.values(dbRows)) map.clear();
  auditLogs.length = 0;
  notifications.length = 0;
}

function matches(row: Row, where: Where = {}): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === "OR" && Array.isArray(value)) {
      if (!value.some((clause) => matches(row, clause as Where))) return false;
      continue;
    }
    if (key === "AND" && Array.isArray(value)) {
      if (!value.every((clause) => matches(row, clause as Where))) return false;
      continue;
    }
    if (value && typeof value === "object" && "in" in value) {
      if (!((value as { in: unknown[] }).in).includes(row[key])) return false;
      continue;
    }
    if (value && typeof value === "object" && "notIn" in value) {
      if (((value as { notIn: unknown[] }).notIn).includes(row[key])) return false;
      continue;
    }
    if (value && typeof value === "object" && "not" in value) {
      if (row[key] === (value as Row).not) return false;
      continue;
    }
    if (value && typeof value === "object" && "lt" in value) {
      const current = row[key] as Date | null | undefined;
      if (!current || current >= (value as { lt: Date }).lt) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

function project(row: Row, select?: Row): Row {
  if (!select) return row;
  const result: Row = {};
  for (const [key, value] of Object.entries(select)) {
    if (value === true) result[key] = row[key];
    else if (value && typeof value === "object" && "select" in value) {
      const related = row[key];
      result[key] = Array.isArray(related)
        ? related.map((entry) => project(entry as Row, (value as Row).select as Row))
        : project((related as Row) ?? {}, (value as Row).select as Row);
    }
  }
  return result;
}

function hydrateOrder(order: Row) {
  return {
    ...order,
    items: [...dbRows.orderItems.values()].filter((i) => i.orderId === order.id),
    seller: dbRows.sellers.get(String(order.sellerId)) ?? null,
  };
}

function hydrateFulfilment(row: Row) {
  const order = dbRows.orders.get(String(row.orderId));
  const supplier = dbRows.suppliers.get(String(row.supplierId));
  const seller = dbRows.sellers.get(String(row.sellerId));
  const supplierProduct = dbRows.supplierProducts.get(String(row.supplierProductId));
  const product = dbRows.products.get(String(row.productId));
  return {
    ...row,
    order: order ? { ...order, seller: dbRows.sellers.get(String(order.sellerId)) ?? null } : null,
    supplier: supplier ?? null,
    seller: seller ?? null,
    supplierProduct: supplierProduct ?? null,
    product: product ?? null,
    purchase: [...dbRows.purchases.values()].find((p) => p.fulfilmentId === row.id) ?? null,
    returnRequest: [...dbRows.returns.values()].find((r) => r.fulfilmentId === row.id) ?? null,
  };
}

function hydratePurchase(row: Row) {
  const fulfilment = dbRows.fulfilments.get(String(row.fulfilmentId));
  return {
    ...row,
    fulfilment: fulfilment ? hydrateFulfilment(fulfilment) : null,
  };
}

function hydrateReturn(row: Row) {
  const fulfilment = dbRows.fulfilments.get(String(row.fulfilmentId));
  const refund = row.refundId ? dbRows.refunds.get(String(row.refundId)) : null;
  return {
    ...row,
    fulfilment: fulfilment ? hydrateFulfilment(fulfilment) : null,
    refund: refund ?? null,
  };
}

function assertUnique(map: Map<string, Row>, row: Row, keys: string[]) {
  for (const existing of map.values()) {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && existing[key] === row[key]) {
        throw new PrismaKnownError(`Unique constraint failed: ${key}`);
      }
    }
  }
}

type TransactionClient = { [delegate: string]: unknown };

const prisma = {
  user: {
    async findMany({ where }: { where?: Where } = {}) {
      return [...dbRows.users.values()].filter((r) => matches(r, where));
    },
  },
  order: {
    async findUnique({ where, select }: { where: Where; select?: Row }) {
      const row = dbRows.orders.get(String(where.id));
      return row ? project(hydrateOrder(row), select) : null;
    },
    async update({ where, data }: { where: Where; data: Row }) {
      const row = dbRows.orders.get(String(where.id));
      if (!row) throw new PrismaKnownError("missing order");
      Object.assign(row, data);
      return row;
    },
  },
  orderItem: {
    async findUnique({ where, select }: { where: Where; select?: Row }) {
      const row = dbRows.orderItems.get(String(where.id));
      return row ? project(row, select) : null;
    },
  },
  supplier: {
    async findUnique({ where }: { where: Where }) {
      return dbRows.suppliers.get(String(where.id)) ?? null;
    },
  },
  supplierProduct: {
    async findUnique({ where, select }: { where: Where; select?: Row }) {
      const row = dbRows.supplierProducts.get(String(where.id));
      if (!row) return null;
      const hydrated = { ...row, supplier: dbRows.suppliers.get(String(row.supplierId)) ?? null };
      return select ? project(hydrated, select) : hydrated;
    },
  },
  seller: {
    async findUnique({ where }: { where: Where }) {
      return [...dbRows.sellers.values()].find((r) => r.userId === where.userId) ?? null;
    },
  },
  payment: {
    async findFirst({ where }: { where?: Where } = {}) {
      return [...dbRows.payments.values()].find((r) => matches(r, where)) ?? null;
    },
  },
  orderShipment: {
    async findUnique({ where }: { where: Where }) {
      return [...dbRows.shipments.values()].find((r) => r.orderId === where.orderId) ?? null;
    },
    async update({ where, data }: { where: Where; data: Row }) {
      const row = [...dbRows.shipments.values()].find((r) => r.orderId === where.orderId);
      if (!row) throw new PrismaKnownError("missing shipment");
      Object.assign(row, data);
      return row;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), ...data };
      dbRows.shipments.set(String(row.id), row);
      return row;
    },
  },
  supplierFulfilment: {
    async findUnique({ where, select }: { where: Where; select?: Row }) {
      const row = [...dbRows.fulfilments.values()].find((r) => matches(r, where));
      return row ? project(hydrateFulfilment(row), select) : null;
    },
    async findMany({ where, select }: { where?: Where; select?: Row } = {}) {
      return [...dbRows.fulfilments.values()]
        .filter((r) => matches(r, where))
        .map((r) => project(hydrateFulfilment(r), select));
    },
    async count({ where }: { where?: Where } = {}) {
      return [...dbRows.fulfilments.values()].filter((r) => matches(r, where)).length;
    },
    async create({ data, select }: { data: Row; select?: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      assertUnique(dbRows.fulfilments, row, ["orderItemId", "reference"]);
      dbRows.fulfilments.set(String(row.id), row);
      return select ? project(row, select) : row;
    },
    async updateMany({ where, data }: { where: Where; data: Row }) {
      const rows = [...dbRows.fulfilments.values()].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
      return { count: rows.length };
    },
  },
  supplierFulfilmentEvent: {
    async findUnique({ where }: { where: Where }) {
      return [...dbRows.events.values()].find((r) => matches(r, where)) ?? null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), ...data };
      assertUnique(dbRows.events, row, ["idempotencyKey"]);
      dbRows.events.set(String(row.id), row);
      return row;
    },
  },
  supplierPurchase: {
    async findUnique({ where, select }: { where: Where; select?: Row }) {
      const row = [...dbRows.purchases.values()].find((r) => matches(r, where));
      return row ? project(hydratePurchase(row), select) : null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data, refundAmountMinor: 0 };
      assertUnique(dbRows.purchases, row, ["fulfilmentId", "idempotencyKey", "purchaseReference"]);
      dbRows.purchases.set(String(row.id), row);
      return row;
    },
    async updateMany({ where, data }: { where: Where; data: Row }) {
      const rows = [...dbRows.purchases.values()].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
      return { count: rows.length };
    },
  },
  supplierReturnRequest: {
    async findUnique({ where, select }: { where: Where; select?: Row }) {
      const row = [...dbRows.returns.values()].find((r) => matches(r, where));
      return row ? project(hydrateReturn(row), select) : null;
    },
    async create({ data, select }: { data: Row; select?: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      assertUnique(dbRows.returns, row, ["fulfilmentId", "idempotencyKey"]);
      dbRows.returns.set(String(row.id), row);
      return select ? project(row, select) : row;
    },
    async update({ where, data }: { where: Where; data: Row }) {
      const row = dbRows.returns.get(String(where.id));
      if (!row) throw new PrismaKnownError("missing return");
      Object.assign(row, data);
      return row;
    },
    async updateMany({ where, data }: { where: Where; data: Row }) {
      const rows = [...dbRows.returns.values()].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
      return { count: rows.length };
    },
    async count({ where }: { where?: Where } = {}) {
      return [...dbRows.returns.values()].filter((r) => matches(r, where)).length;
    },
  },
  buyerProtectionCase: {
    async findUnique({ where }: { where: Where }) {
      return [...dbRows.cases.values()].find((r) => matches(r, where)) ?? null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), openedAt: new Date(), updatedAt: new Date(), ...data };
      assertUnique(dbRows.cases, row, ["orderId"]);
      dbRows.cases.set(String(row.id), row);
      return row;
    },
    async update({ where, data }: { where: Where; data: Row }) {
      const row = dbRows.cases.get(String(where.id));
      if (!row) throw new PrismaKnownError("missing case");
      Object.assign(row, data);
      return row;
    },
  },
  refund: {
    async findUnique({ where }: { where: Where }) {
      return [...dbRows.refunds.values()].find((r) => matches(r, where)) ?? null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      assertUnique(dbRows.refunds, row, ["idempotencyKey"]);
      dbRows.refunds.set(String(row.id), row);
      return row;
    },
    async updateMany({ where, data }: { where: Where; data: Row }) {
      const rows = [...dbRows.refunds.values()].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
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
    getCurrentUser: async () => null,
    isAdministratorRole: (role: string) => role === "ADMIN" || role === "SUPER_ADMIN",
  },
});
mock.module("@/services/audit-service", {
  namedExports: {
    logAuditEvent: async (params: Row) => {
      auditLogs.push(params);
      return { id: randomUUID() };
    },
  },
});
mock.module("@/modules/notifications/service", {
  namedExports: {
    notifyUser: async (params: Row) => {
      notifications.push(params);
      return { id: randomUUID() };
    },
  },
});

let fulfilmentService: typeof import("@/services/dropshipping-fulfilment-service");
let purchaseService: typeof import("@/services/dropshipping-purchase-service");
let returnService: typeof import("@/services/dropshipping-return-service");

const ADMIN_ID = randomUUID();
const SELLER_USER_ID = randomUUID();
const OTHER_SELLER_USER_ID = randomUUID();
const BUYER_ID = randomUUID();
const SELLER_ID = randomUUID();
const SUPPLIER_ID = randomUUID();
const SUPPLIER_PRODUCT_ID = randomUUID();
const ORDER_ID = randomUUID();
const ORDER_ITEM_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PAYMENT_ID = randomUUID();

function seedBase() {
  dbRows.users.set(ADMIN_ID, { id: ADMIN_ID, role: "ADMIN", isActive: true, isBanned: false });
  dbRows.users.set(SELLER_USER_ID, { id: SELLER_USER_ID, role: "SELLER", isActive: true, isBanned: false });
  dbRows.users.set(BUYER_ID, { id: BUYER_ID, role: "BUYER", isActive: true, isBanned: false });
  dbRows.sellers.set(SELLER_ID, { id: SELLER_ID, userId: SELLER_USER_ID, verificationStatus: "VERIFIED" });
  dbRows.suppliers.set(SUPPLIER_ID, {
    id: SUPPLIER_ID, name: "Nairobi Supplies", status: "APPROVED",
    paymentResponsibility: "SELLER", paymentTerms: "Prepaid before dispatch",
    dispatchEstimateMaxDays: 3,
  });
  dbRows.supplierProducts.set(SUPPLIER_PRODUCT_ID, {
    id: SUPPLIER_PRODUCT_ID, supplierId: SUPPLIER_ID, title: "Solar Lantern", sku: "SL-001",
    costMinor: 150000, currency: "KES", deliveryChargeMinor: 5000,
    costStatus: "CONFIRMED", stockStatus: "IN_STOCK", stockVerifiedAt: new Date(),
  });
  dbRows.products.set(PRODUCT_ID, { id: PRODUCT_ID, title: "Solar Lantern", slug: "solar-lantern", sellerId: SELLER_ID });
  dbRows.orders.set(ORDER_ID, {
    id: ORDER_ID, orderNumber: "MH-TEST-001", status: "PAID", buyerId: BUYER_ID,
    sellerId: SELLER_ID, totalCents: 250000, createdAt: new Date(),
  });
  dbRows.orderItems.set(ORDER_ITEM_ID, {
    id: ORDER_ITEM_ID, orderId: ORDER_ID, productId: PRODUCT_ID, quantity: 1,
    unitPriceCents: 250000, totalCents: 250000, supplierProductId: SUPPLIER_PRODUCT_ID,
    supplierProductTitle: "Solar Lantern", supplierSku: "SL-001", createdAt: new Date(),
  });
  dbRows.payments.set(PAYMENT_ID, {
    id: PAYMENT_ID, orderId: ORDER_ID, status: "SUCCESS", provider: "PAYSTACK",
    amountCents: 250000, createdAt: new Date(),
  });
}

async function createTask() {
  const result = await fulfilmentService.ensureSupplierFulfilmentsForPaidOrder(
    prisma as never,
    ORDER_ID,
  );
  assert.equal(result.created, 1);
  return [...dbRows.fulfilments.values()][0]!;
}

function sellerActor() {
  return { id: SELLER_USER_ID, email: "seller@malihub.test", role: "SELLER" as const };
}
function adminActor() {
  return { id: ADMIN_ID, email: "admin@malihub.test", role: "ADMIN" as const };
}

before(async () => {
  fulfilmentService = await import("@/services/dropshipping-fulfilment-service");
  purchaseService = await import("@/services/dropshipping-purchase-service");
  returnService = await import("@/services/dropshipping-return-service");
});

beforeEach(() => {
  resetDb();
  seedBase();
});

describe("verified-payment supplier fulfilment fan-out", () => {
  it("creates exactly one task per supplier order item on repeated payment events", async () => {
    const first = await fulfilmentService.ensureSupplierFulfilmentsForPaidOrder(prisma as never, ORDER_ID);
    const second = await fulfilmentService.ensureSupplierFulfilmentsForPaidOrder(prisma as never, ORDER_ID);
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 1);
    assert.equal(dbRows.fulfilments.size, 1);
    assert.equal(dbRows.purchases.size, 0, "no supplier order before availability confirmation");
    const task = [...dbRows.fulfilments.values()][0]!;
    assert.equal(task.status, "AWAITING_SUPPLIER_CONFIRMATION");
    assert.equal(task.unitCostMinor, 150000);
    assert.equal(task.totalCostMinor, 155000);
    assert.ok(auditLogs.some((log) => log.action === "supplier_fulfilment.created"));
    assert.ok(notifications.some((n) => String(n.body).includes("Confirm availability")));
  });

  it("does not create tasks for unpaid orders", async () => {
    dbRows.orders.get(ORDER_ID)!.status = "PENDING";
    const result = await fulfilmentService.ensureSupplierFulfilmentsForPaidOrder(prisma as never, ORDER_ID);
    assert.deepEqual(result, { created: 0, skipped: 0, exceptions: 0 });
    assert.equal(dbRows.fulfilments.size, 0);
  });

  it("supports multiple suppliers on one customer order with separate tasks", async () => {
    const secondSupplierId = randomUUID();
    const secondProductId = randomUUID();
    const secondItemId = randomUUID();
    dbRows.suppliers.set(secondSupplierId, { id: secondSupplierId, name: "MombasaGoods", status: "APPROVED" });
    dbRows.supplierProducts.set(secondProductId, {
      id: secondProductId, supplierId: secondSupplierId, title: "Radio", sku: "R-1",
      costMinor: 80000, currency: "KES", deliveryChargeMinor: 0, costStatus: "ESTIMATED",
    });
    dbRows.orderItems.set(secondItemId, {
      id: secondItemId, orderId: ORDER_ID, productId: PRODUCT_ID, quantity: 1,
      unitPriceCents: 120000, totalCents: 120000, supplierProductId: secondProductId,
    });
    const result = await fulfilmentService.ensureSupplierFulfilmentsForPaidOrder(prisma as never, ORDER_ID);
    assert.equal(result.created, 2);
    assert.equal(new Set([...dbRows.fulfilments.values()].map((f) => f.supplierId)).size, 2);
  });
});

describe("supplier fulfilment transitions", () => {
  it("requires ownership, final cost and an idempotency-safe replay", async () => {
    const task = await createTask();
    const otherSeller = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: String(task.id),
      action: "CONFIRM_AVAILABILITY",
      actor: { id: OTHER_SELLER_USER_ID, role: "SELLER" },
      finalUnitCostMinor: 160000,
    }).catch((error) => error as { code: string });
    assert.equal((otherSeller as { code: string }).code, "forbidden");

    const key = "fixed-confirm-key";
    const result = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: String(task.id),
      action: "CONFIRM_AVAILABILITY",
      actor: sellerActor(),
      finalUnitCostMinor: 160000,
      idempotencyKey: key,
    });
    assert.equal(result.to, "CONFIRMED");
    assert.equal(dbRows.purchases.size, 1);
    const purchase = [...dbRows.purchases.values()][0]!;
    assert.equal(purchase.amountMinor, 165000);
    assert.equal(purchase.status, "PENDING_CONFIRMATION");

    const replay = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: String(task.id),
      action: "CONFIRM_AVAILABILITY",
      actor: sellerActor(),
      finalUnitCostMinor: 160000,
      idempotencyKey: key,
    });
    assert.equal(replay.idempotent, true);
    assert.equal(dbRows.purchases.size, 1);
    assert.equal(dbRows.events.size, 2); // creation event + one transition event
  });

  it("refuses to record a supplier order before the purchase is confirmed", async () => {
    const task = await createTask();
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: String(task.id), action: "CONFIRM_AVAILABILITY",
      actor: sellerActor(), finalUnitCostMinor: 150000,
    });
    const error = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: String(task.id), action: "RECORD_PURCHASE",
      actor: sellerActor(), supplierReference: "SUP-ORDER-1",
    }).catch((e) => e as { code: string });
    assert.equal((error as { code: string }).code, "purchase_not_confirmed");
  });

  it("records manual tracking and requires admin-reviewed evidence for delivery", async () => {
    const task = await createTask();
    const taskId = String(task.id);
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM_AVAILABILITY", actor: sellerActor(), finalUnitCostMinor: 150000,
    });
    await purchaseService.handleSupplierPurchaseAction(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM", actor: { id: SELLER_USER_ID, role: "SELLER" },
    });
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "RECORD_PURCHASE", actor: sellerActor(), supplierReference: "SUP-ORDER-1",
    });
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "RECORD_DISPATCH", actor: sellerActor(),
      carrierName: "Manual Courier", trackingNumber: "TRK-001",
    });
    assert.equal(dbRows.shipments.size, 1);
    assert.equal([...dbRows.shipments.values()][0]!.status, "IN_TRANSIT");
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "RECORD_IN_TRANSIT", actor: sellerActor(),
      carrierName: "Manual Courier", trackingNumber: "TRK-001",
    });

    const sellerDelivery = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "RECORD_DELIVERY", actor: sellerActor(),
      deliveryEvidenceNote: "Driver said it arrived",
    }).catch((e) => e as { code: string });
    assert.equal((sellerDelivery as { code: string }).code, "delivery_review_required");

    const adminNoEvidence = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "RECORD_DELIVERY", actor: adminActor(),
    }).catch((e) => e as { code: string });
    assert.equal((adminNoEvidence as { code: string }).code, "delivery_evidence_required");

    const delivered = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "RECORD_DELIVERY", actor: adminActor(),
      deliveryEvidenceNote: "Courier proof of delivery reviewed by admin.",
    });
    assert.equal(delivered.to, "DELIVERED");
    assert.ok(dbRows.orders.get(ORDER_ID)!.deliveredAt);
    assert.equal(dbRows.orders.get(ORDER_ID)!.payoutEligibleAt, undefined);
  });

  it("marks a failed task and cancels the purchase without issuing a refund", async () => {
    const task = await createTask();
    const taskId = String(task.id);
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM_AVAILABILITY", actor: sellerActor(), finalUnitCostMinor: 150000,
    });
    const result = await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "REPORT_FAILURE", actor: sellerActor(),
      reason: "Supplier confirmed out of stock.",
    });
    assert.equal(result.to, "FAILED");
    assert.equal([...dbRows.purchases.values()][0]!.status, "FAILED");
    assert.equal(dbRows.refunds.size, 0);
  });
});

describe("supplier purchase controls", () => {
  it("requires commercial terms, is idempotent, and never moves money", async () => {
    const task = await createTask();
    const taskId = String(task.id);
    await fulfilmentService.transitionSupplierFulfilment(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM_AVAILABILITY", actor: sellerActor(), finalUnitCostMinor: 150000,
    });
    const purchaseRow = [...dbRows.purchases.values()][0]!;
    purchaseRow.paymentResponsibility = "UNDEFINED";
    const denied = await purchaseService.handleSupplierPurchaseAction(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM", actor: { id: SELLER_USER_ID, role: "SELLER" },
    }).catch((e) => e as { code: string });
    assert.equal((denied as { code: string }).code, "commercial_terms_missing");

    // An admin verifies the commercial terms again; no second purchase row.
    purchaseRow.paymentResponsibility = "SELLER";
    purchaseRow.paymentTerms = "Prepaid before dispatch";
    const first = await purchaseService.handleSupplierPurchaseAction(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM", actor: { id: SELLER_USER_ID, role: "SELLER" },
    });
    const second = await purchaseService.handleSupplierPurchaseAction(prisma as never, {
      fulfilmentId: taskId, action: "CONFIRM", actor: { id: SELLER_USER_ID, role: "SELLER" },
    });
    assert.equal(first.status, "CONFIRMED");
    assert.equal(second.idempotent, true);
    assert.equal(dbRows.purchases.size, 1);

    const reconciled = await purchaseService.handleSupplierPurchaseAction(prisma as never, {
      fulfilmentId: taskId, action: "RECONCILE",
      actor: { id: ADMIN_ID, role: "ADMIN" },
      paymentReference: "BANK-STATEMENT-001",
      reconciliationNote: "Manual bank transfer matched to supplier invoice.",
    });
    assert.equal(reconciled.status, "CONFIRMED");
    assert.equal(reconciled.customerOrderTotalCents, 250000);
    assert.ok(dbRows.purchases.get(String(first.id))!.paidAt);
    assert.equal(dbRows.purchases.get(String(first.id))!.reconciledAt instanceof Date, true);
  });
});

describe("returns, disputes and payout holds", () => {
  it("opens a protection case, holds payout and prevents duplicate requests", async () => {
    const task = await createTask();
    const taskId = String(task.id);
    const key = "return-request-key";
    const first = await returnService.createSupplierReturnRequest(prisma as never, {
      fulfilmentId: taskId, buyerId: BUYER_ID, reason: "UNDELIVERED",
      reasonNote: "The parcel did not arrive after the expected delivery window.",
      idempotencyKey: key,
    });
    const replay = await returnService.createSupplierReturnRequest(prisma as never, {
      fulfilmentId: taskId, buyerId: BUYER_ID, reason: "UNDELIVERED",
      reasonNote: "The parcel did not arrive after the expected delivery window.",
      idempotencyKey: key,
    });
    await returnService.afterReturnRequestCreated(prisma as never, first);
    assert.equal(first.status, "REQUESTED");
    assert.equal(replay.idempotent, true);
    assert.equal(dbRows.returns.size, 1);
    assert.equal(dbRows.cases.size, 1);
    assert.equal([...dbRows.cases.values()][0]!.status, "OPEN");
    assert.ok(auditLogs.some((log) => log.action === "supplier_return.payout_hold"));
  });

  it("creates at most one pending refund request and requires provider completion", async () => {
    const task = await createTask();
    const taskId = String(task.id);
    const request = await returnService.createSupplierReturnRequest(prisma as never, {
      fulfilmentId: taskId, buyerId: BUYER_ID, reason: "DAMAGED",
      reasonNote: "Item arrived broken and unusable.",
    });
    const requestId = String(request.id);

    await returnService.updateSupplierReturnStatus(prisma as never, {
      returnRequestId: requestId, status: "APPROVED", actor: { id: ADMIN_ID, role: "ADMIN" },
      responsibility: "SUPPLIER",
    });
    await returnService.updateSupplierReturnStatus(prisma as never, {
      returnRequestId: requestId, status: "ITEM_RETURNED", actor: { id: ADMIN_ID, role: "ADMIN" },
    });
    const refundPending = await returnService.updateSupplierReturnStatus(prisma as never, {
      returnRequestId: requestId, status: "REFUND_PENDING", actor: { id: ADMIN_ID, role: "ADMIN" },
    });
    assert.equal(dbRows.refunds.size, 1);
    assert.equal([...dbRows.refunds.values()][0]!.status, "PENDING");
    assert.equal(refundPending.payoutHoldActive, true);

    // A replay of the same status must not create a second refund instruction.
    await assert.rejects(
      () => returnService.updateSupplierReturnStatus(prisma as never, {
        returnRequestId: requestId, status: "REFUND_PENDING", actor: { id: ADMIN_ID, role: "ADMIN" },
      }),
      (error: unknown) => (error as { code?: string }).code === "unchanged",
    );
    assert.equal(dbRows.refunds.size, 1);

    const unconfirmed = await returnService.updateSupplierReturnStatus(prisma as never, {
      returnRequestId: requestId, status: "RESOLVED", actor: { id: ADMIN_ID, role: "ADMIN" },
      resolutionNote: "Buyer says refund is done.",
    }).catch((e) => e as { code: string });
    assert.equal((unconfirmed as { code: string }).code, "refund_not_confirmed");

    // Only a provider-confirmed COMPLETED Refund row can release the hold.
    await prisma.refund.updateMany({ where: { id: refundPending.refundId! }, data: { status: "COMPLETED" } });
    const resolved = await returnService.updateSupplierReturnStatus(prisma as never, {
      returnRequestId: requestId, status: "RESOLVED", actor: { id: ADMIN_ID, role: "ADMIN" },
      resolutionNote: "Provider confirmed the refund.", responsibility: "SUPPLIER",
    });
    assert.equal(resolved.payoutHoldActive, false);
    assert.equal([...dbRows.cases.values()][0]!.status, "RESOLVED_BUYER");
  });

  it("denies a return request from a different buyer", async () => {
    const task = await createTask();
    const error = await returnService.createSupplierReturnRequest(prisma as never, {
      fulfilmentId: String(task.id), buyerId: randomUUID(), reason: "OTHER",
      reasonNote: "This is not my order but I want to open a dispute.",
    }).catch((e) => e as { code: string });
    assert.equal((error as { code: string }).code, "forbidden");
  });
});
