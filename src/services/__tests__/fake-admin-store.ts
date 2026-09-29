import { randomUUID } from "node:crypto";

/**
 * An in-memory stand-in for the slice of Prisma the admin service uses —
 * the same role `fake-marketplace-store.ts` plays for orders and
 * `fake-account-store.ts` plays for provisioning.
 *
 * It deliberately mirrors the Postgres semantics the admin code depends on:
 *  - `update`/`delete` on a missing row raises Prisma's `P2025` (so a forged
 *    target id fails the service's "not found" path instead of silently
 *    no-op'ing);
 *  - `slug` on categories and `orderNumber` on orders are UNIQUE (`P2002`);
 *  - relation-shaped filters (`seller: { businessName: { contains } }`) match
 *    like Prisma's inner-join semantics for to-one and "some" for to-many.
 *
 * Anything beyond the operators admin-service actually uses throws loudly —
 * a fake that quietly ignores a filter would silently make authorization
 * tests meaningless.
 */

export class FakePrismaError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
  }
}

type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;
type Args = Record<string, unknown>;

/** Which table + key a relation points at, and whether it's a collection. */
type RelationDef =
  | { table: string; localField: string; foreignField: string; many: false }
  | { table: string; localField: string; foreignField: string; many: true };

/** Tables the admin screens touch. Keys are typed on purpose: a typo in a
 * test (`tables.seller`) must fail at compile time, not read as `undefined`. */
export type AdminTables = {
  users: Map<string, Row>;
  profiles: Map<string, Row>;
  sellers: Map<string, Row>;
  products: Map<string, Row>;
  productImages: Map<string, Row>;
  categories: Map<string, Row>;
  orders: Map<string, Row>;
  orderItems: Map<string, Row>;
  payments: Map<string, Row>;
  settlements: Map<string, Row>;
  refunds: Map<string, Row>;
  wishlists: Map<string, Row>;
  reviews: Map<string, Row>;
  reports: Map<string, Row>;
  listingViews: Map<string, Row>;
  payoutAccounts: Map<string, Row>;
  notifications: Map<string, Row>;
  auditLogs: Map<string, Row>;
};

export type FakeAdminStore = {
  tables: AdminTables;
  operations: string[];
  /** The Prisma-shaped delegates (`user`, `product`, `auditLog`, …). */
  [delegate: string]: unknown;
};

const RELATIONS: Record<string, Record<string, RelationDef>> = {
  user: {
    profile: { table: "profiles", localField: "id", foreignField: "userId", many: false },
    seller: { table: "sellers", localField: "id", foreignField: "userId", many: false },
    products: { table: "products", localField: "id", foreignField: "ownerId", many: true },
    orders: { table: "orders", localField: "id", foreignField: "buyerId", many: true },
    wishlists: { table: "wishlists", localField: "id", foreignField: "userId", many: true },
    reviews: { table: "reviews", localField: "id", foreignField: "authorId", many: true },
    notifications: { table: "notifications", localField: "id", foreignField: "userId", many: true },
  },
  seller: {
    user: { table: "users", localField: "userId", foreignField: "id", many: false },
    products: { table: "products", localField: "id", foreignField: "sellerId", many: true },
    orders: { table: "orders", localField: "id", foreignField: "sellerId", many: true },
    payoutAccounts: { table: "payoutAccounts", localField: "id", foreignField: "sellerId", many: true },
  },
  product: {
    seller: { table: "sellers", localField: "sellerId", foreignField: "id", many: false },
    category: { table: "categories", localField: "categoryId", foreignField: "id", many: false },
    owner: { table: "users", localField: "ownerId", foreignField: "id", many: false },
    images: { table: "productImages", localField: "id", foreignField: "productId", many: true },
    orderItems: { table: "orderItems", localField: "id", foreignField: "productId", many: true },
    wishlists: { table: "wishlists", localField: "id", foreignField: "productId", many: true },
    reviews: { table: "reviews", localField: "id", foreignField: "productId", many: true },
    reports: { table: "reports", localField: "id", foreignField: "productId", many: true },
    listingViews: { table: "listingViews", localField: "id", foreignField: "productId", many: true },
  },
  order: {
    buyer: { table: "users", localField: "buyerId", foreignField: "id", many: false },
    seller: { table: "sellers", localField: "sellerId", foreignField: "id", many: false },
    items: { table: "orderItems", localField: "id", foreignField: "orderId", many: true },
    payments: { table: "payments", localField: "id", foreignField: "orderId", many: true },
    settlement: { table: "settlements", localField: "id", foreignField: "orderId", many: false },
    refunds: { table: "refunds", localField: "id", foreignField: "orderId", many: true },
  },
  orderItem: {
    product: { table: "products", localField: "productId", foreignField: "id", many: false },
  },
  category: {
    parent: { table: "categories", localField: "parentId", foreignField: "id", many: false },
    children: { table: "categories", localField: "id", foreignField: "parentId", many: true },
    products: { table: "products", localField: "id", foreignField: "categoryId", many: true },
  },
  profile: {
    user: { table: "users", localField: "userId", foreignField: "id", many: false },
  },
  payment: {
    order: { table: "orders", localField: "orderId", foreignField: "id", many: false },
  },
};

const TABLE_ALIASES: Record<string, string> = {
  user: "users",
  profile: "profiles",
  seller: "sellers",
  product: "products",
  productImage: "productImages",
  category: "categories",
  order: "orders",
  orderItem: "orderItems",
  payment: "payments",
  settlement: "settlements",
  refund: "refunds",
  wishlist: "wishlists",
  review: "reviews",
  report: "reports",
  listingView: "listingViews",
  payoutAccount: "payoutAccounts",
  notification: "notifications",
  auditLog: "auditLogs",
};

const UNIQ: Record<string, string[]> = {
  categories: ["slug"],
  orders: ["orderNumber"],
  users: ["email", "authUserId"],
  sellers: ["userId", "slug"],
  products: ["slug"],
  profiles: ["userId"],
  notifications: [],
  auditLogs: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Nested Prisma writes ({create: …} / {connect: …} / arrays of those), as
 * opposed to Json column payloads (metadata), which must survive. */
function isRelationWrite(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isRelationWrite);
  if (!isPlainObject(value)) return false;
  return ["create", "connect", "createMany", "set", "disconnect"].some((k) => k in value);
}

function matches(row: Row, where: Where, table: string): boolean {
  if (!where || Object.keys(where).length === 0) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      const branches = condition as Where[];
      if (!branches.some((branch) => matches(row, branch, table))) return false;
      continue;
    }
    if (key === "AND") {
      const branches = condition as Where[];
      if (!branches.every((branch) => matches(row, branch, table))) return false;
      continue;
    }
    if (key === "NOT") {
      const branch = condition as Where;
      if (matches(row, branch, table)) return false;
      continue;
    }
    const relation = RELATIONS[singular(table)]?.[key];
    if (relation && isPlainObject(condition)) {
      // Relation filter: to-one must exist and match; to-many is "some".
      const related = rowsForRelation(row, relation, table);
      if (!relation.many) {
        if (related.length === 0) return false;
        if (!matches(related[0]!, condition as Where, relation.table)) return false;
      } else if (!related.some((r) => matches(r, condition as Where, relation.table))) {
        return false;
      }
      continue;
    }
    const value = row[key];
    if (isPlainObject(condition)) {
      for (const [op, operand] of Object.entries(condition)) {
        switch (op) {
          case "contains": {
            if (typeof value !== "string") return false;
            const needle = String(operand);
            const insensitive = (condition as Record<string, unknown>).mode === "insensitive";
            const hay = insensitive ? value.toLowerCase() : value;
            const q = insensitive ? needle.toLowerCase() : needle;
            if (!hay.includes(q)) return false;
            break;
          }
          case "in":
            if (!Array.isArray(operand) || !operand.includes(value)) return false;
            break;
          case "notIn":
            if (!Array.isArray(operand) || operand.includes(value)) return false;
            break;
          case "not":
            if (matches({ [key]: value }, { [key]: operand } as Where, table)) return false;
            break;
          case "equals":
            if (value !== operand) return false;
            break;
          case "lte":
            if (!(Number(value) <= Number(operand))) return false;
            break;
          case "gte":
            if (!(Number(value) >= Number(operand))) return false;
            break;
          case "mode":
            break; // consumed by `contains`
          default:
            throw new Error(`fake-admin-store: unsupported filter operator "${op}" on "${key}"`);
        }
      }
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
}

function singular(table: string): string {
  if (table.endsWith("ies")) return `${table.slice(0, -3)}y`;
  if (table.endsWith("s")) return table.slice(0, -1);
  return table;
}

function rowsForRelation(row: Row, relation: RelationDef, _fromTable: string): Row[] {
  const table = storeTables[relation.table];
  if (!table) return [];
  const all = [...table.values()];
  const local = row[relation.localField];
  if (!relation.many) {
    const found = all.find((r) => r[relation.foreignField] === local);
    return found ? [found] : [];
  }
  return all.filter((r) => r[relation.foreignField] === local);
}

let storeTables: Record<string, Map<string, Row>> = {};

/** Tables a relation filter may point at, resolved through the row's own
 * foreign key. Used only by `matches()` when a `where` key is a relation. */

function project(row: Row, table: string, args: Args): Row {
  const select = args.select as Record<string, unknown> | undefined;
  const include = args.include as Record<string, unknown> | undefined;
  if (!select && !include) return { ...row };
  const out: Row = {};
  if (include) {
    // `include` returns every scalar plus the named relations; only `select`
    // is a strict projection.
    for (const [key, value] of Object.entries(row)) {
      if (!RELATIONS[singular(table)]?.[key]) out[key] = value;
    }
  }
  const specs = { ...(include ?? {}), ...(select ?? {}) };
  for (const [key, spec] of Object.entries(specs)) {
    if (spec === false) continue;
    if (key === "_count" && isPlainObject(spec)) {
      // Prisma's shape is `_count: { select: { rel: true } }`.
      const requested = ((spec as Record<string, unknown>).select ?? {}) as Record<string, boolean>;
      const counts: Record<string, number> = {};
      for (const [rel, on] of Object.entries(requested)) {
        if (!on) continue;
        const relation = RELATIONS[singular(table)]?.[rel];
        if (!relation) throw new Error(`fake-admin-store: unknown _count relation "${rel}" on ${table}`);
        counts[rel] = rowsForRelation(row, relation, table).length;
      }
      out._count = counts;
      continue;
    }
    const relation = RELATIONS[singular(table)]?.[key];
    if (relation && (spec === true || isPlainObject(spec))) {
      const related = rowsForRelation(row, relation, table);
      const subArgs: Args = spec === true ? {} : (spec as Args);
      if (relation.many) {
        let list = related.map((r) => project(r, relation.table, subArgs));
        const orderBy = subArgs.orderBy as { [field: string]: "asc" | "desc" } | undefined;
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]!;
          list = [...list].sort((a, b) => {
            const av = a[field as string] as never;
            const bv = b[field as string] as never;
            return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "desc" ? -1 : 1);
          });
        }
        const take = subArgs.take as number | undefined;
        if (typeof take === "number") list = list.slice(0, take);
        out[key] = list;
      } else {
        out[key] = related.length > 0 ? project(related[0]!, relation.table, subArgs) : null;
      }
      continue;
    }
    if (spec === true) {
      out[key] = row[key];
      continue;
    }
    throw new Error(`fake-admin-store: unsupported select/include key "${key}" on ${table}`);
  }
  return out;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Array<Record<string, "asc" | "desc">>;
  const sorted = [...rows];
  for (const spec of [...specs].reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      sorted.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        const cmp = av === bv ? 0 : (av as never) < (bv as never) ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
  }
  return sorted;
}

function assertUnique(table: string, row: Row, tables: Record<string, Map<string, Row> | undefined>, ignoreId?: string) {
  for (const field of UNIQ[table] ?? []) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    for (const [id, existing] of tables[table] ?? new Map<string, Row>()) {
      if (ignoreId && id === ignoreId) continue;
      if (existing[field] === value) {
        throw new FakePrismaError("P2002", `Unique constraint failed on ${field}`);
      }
    }
  }
}

function makeDelegate(table: string, tables: Record<string, Map<string, Row> | undefined>) {
  const map: Map<string, Row> = tables[table] ?? (tables[table] = new Map<string, Row>());
  const uniqueFieldFor = (where: Row): string => {
    const fields = ["id", ...(UNIQ[table] ?? []).filter((f) => f !== "id"), "userId"];
    for (const field of fields) {
      if (field in where) return field;
    }
    throw new FakePrismaError("P2004", `fake-admin-store: findUnique on ${table} needs a unique where`);
  };

  const findWhere = (where: Row): Row | null => {
    const field = uniqueFieldFor(where);
    const value = where[field];
    for (const row of map.values()) {
      if (row[field] === value) return row;
    }
    return null;
  };

  return {
    async create(args: Args) {
      const data = { ...(args.data as Row) };
      if (data.id === undefined) data.id = randomUUID();
      if (data.createdAt === undefined) data.createdAt = new Date();
      if (data.updatedAt === undefined) data.updatedAt = data.createdAt;
      // Drop relation writes (images: { create }) — Json columns like
      // metadata survive, scalars only otherwise.
      for (const key of Object.keys(data)) {
        if (isRelationWrite(data[key])) delete data[key];
      }
      assertUnique(table, data, tables);
      const row = { ...data };
      map.set(String(row.id), row);
      if (args.select || args.include) return project(row, table, args);
      return { ...row };
    },
    async findUnique(args: Args) {
      const row = findWhere(args.where as Row);
      return row ? project(row, table, args) : null;
    },
    async findUniqueOrThrow(args: Args) {
      const row = findWhere(args.where as Row);
      if (!row) throw new FakePrismaError("P2025", `No ${table} found`);
      return project(row, table, args);
    },
    async findFirst(args: Args) {
      const rows = [...map.values()].filter((r) => matches(r, args.where as Where, table));
      const ordered = sortRows(rows, args.orderBy);
      const row = ordered[0];
      return row ? project(row, table, args) : null;
    },
    async findMany(args: Args = {}) {
      let rows = [...map.values()].filter((r) => matches(r, args.where as Where, table));
      rows = sortRows(rows, args.orderBy);
      const skip = (args.skip as number | undefined) ?? 0;
      const take = args.take as number | undefined;
      if (skip) rows = rows.slice(skip);
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => project(r, table, args));
    },
    async count(args: Args = {}) {
      return [...map.values()].filter((r) => matches(r, args.where as Where, table)).length;
    },
    async update(args: Args) {
      const row = findWhere(args.where as Row);
      if (!row) throw new FakePrismaError("P2025", `No ${table} found for update`);
      const data = { ...(args.data as Row) };
      for (const key of Object.keys(data)) {
        if (isRelationWrite(data[key])) delete data[key];
      }
      Object.assign(row, data, { updatedAt: new Date() });
      assertUnique(table, row, tables, String(row.id));
      return args.select || args.include ? project(row, table, args) : { ...row };
    },
    async updateMany(args: Args) {
      const rows = [...map.values()].filter((r) => matches(r, args.where as Where, table));
      for (const row of rows) Object.assign(row, args.data as Row);
      return { count: rows.length };
    },
    async delete(args: Args) {
      const row = findWhere(args.where as Row);
      if (!row) throw new FakePrismaError("P2025", `No ${table} found for delete`);
      map.delete(String(row.id));
      return { ...row };
    },
    async aggregate(args: Args = {}) {
      const rows = [...map.values()].filter((r) => matches(r, args.where as Where, table));
      const sums = args._sum as Record<string, boolean> | undefined;
      const result: Record<string, number | null> = {};
      if (sums) {
        for (const [field, on] of Object.entries(sums)) {
          if (!on) continue;
          result[field] = rows.reduce((acc, row) => acc + Number(row[field] ?? 0), 0);
        }
      }
      return { _sum: result };
    },
  };
}

export function createFakeAdminStore() {
  const tableNames = [
    "users",
    "profiles",
    "sellers",
    "products",
    "productImages",
    "categories",
    "orders",
    "orderItems",
    "payments",
    "settlements",
    "refunds",
    "wishlists",
    "reviews",
    "reports",
    "listingViews",
    "payoutAccounts",
    "notifications",
    "auditLogs",
  ];
  const tables: Record<string, Map<string, Row>> = Object.fromEntries(
    tableNames.map((name) => [name, new Map<string, Row>()])
  );
  storeTables = tables;

  const operations: string[] = [];
  const store = { tables: tables as unknown as AdminTables, operations } as FakeAdminStore;
  for (const delegate of Object.keys(TABLE_ALIASES)) {
    const table = TABLE_ALIASES[delegate]!;
    const inner = makeDelegate(table, tables);
    const wrapped: Record<string, unknown> = {};
    for (const method of Object.keys(inner)) {
      wrapped[method] = async (...args: unknown[]) => {
        operations.push(`${delegate}.${method}`);
        return (inner as Record<string, (...a: unknown[]) => unknown>)[method]!(...(args as []));
      };
    }
    (store as Record<string, unknown>)[delegate] = wrapped;
  }
  return store;
}

export type AdminStore = FakeAdminStore;

// ─── Seeding helpers (test ergonomics mirroring fake-marketplace-store) ────

/** Typed views of the seeded rows so tests read real fields, not `unknown`. */
export type SeededUser = Row & { id: string; email: string; role: string };
export type SeededProfile = Row & { id: string; userId: string; fullName: string };
export type SeededSeller = Row & {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  verificationStatus: string;
};
export type SeededCategory = Row & { id: string; name: string; slug: string };
export type SeededProduct = Row & {
  id: string;
  sellerId: string;
  ownerId: string;
  categoryId: string;
  title: string;
  status: string;
};
export type SeededOrder = Row & { id: string; orderNumber: string; buyerId: string; sellerId: string };
export type SeededReport = Row & { id: string; productId: string; status: string };

type Overrides<T> = Partial<Row> & T;

function put<T extends Row>(
  store: FakeAdminStore,
  table: keyof AdminTables,
  row: T
): T {
  store.tables[table].set(String(row.id), row);
  return row;
}

export function seedUser(store: FakeAdminStore, input: Overrides<{ id?: string; email: string }>): SeededUser {
  const id = (input.id as string | undefined) ?? randomUUID();
  return put(store, "users", {
    authUserId: null,
    phone: null,
    role: "BUYER",
    isActive: true,
    isBanned: false,
    emailVerified: true,
    lastSeenAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...input,
    id,
  }) as unknown as SeededUser;
}

export function seedProfile(
  store: FakeAdminStore,
  input: Overrides<{ userId: string; fullName: string }>
): SeededProfile {
  const userId = input.userId as string;
  return put(store, "profiles", {
    id: `profile-${userId}`,
    avatarUrl: null,
    county: null,
    subCounty: null,
    onboarded: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...input,
    userId,
  }) as unknown as SeededProfile;
}

export function seedSeller(
  store: FakeAdminStore,
  input: Overrides<{ id?: string; userId: string; businessName: string }>
): SeededSeller {
  const id = (input.id as string | undefined) ?? randomUUID();
  const userId = input.userId as string;
  const businessName = input.businessName as string;
  return put(store, "sellers", {
    slug: `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(-4)}`,
    county: "Nairobi",
    subCounty: null,
    verificationStatus: "UNVERIFIED",
    ratingAverage: 0,
    ratingCount: 0,
    totalSales: 0,
    responseRatePct: null,
    description: null,
    logoUrl: null,
    idDocumentUrl: null,
    kraPin: null,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...input,
    id,
    userId,
    businessName,
  }) as unknown as SeededSeller;
}

export function seedCategory(store: FakeAdminStore, input: Overrides<{ id?: string; name: string; slug?: string }>): SeededCategory {
  const id = (input.id as string | undefined) ?? randomUUID();
  const name = input.name as string;
  return put(store, "categories", {
    slug: (input.slug as string | undefined) ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    iconName: null,
    imageUrl: null,
    parentId: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...input,
    id,
    name,
  }) as unknown as SeededCategory;
}

export function seedProduct(
  store: FakeAdminStore,
  input: Overrides<{ id?: string; sellerId: string; ownerId: string; categoryId: string; title: string }>
): SeededProduct {
  const id = (input.id as string | undefined) ?? randomUUID();
  const title = input.title as string;
  return put(store, "products", {
    slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(-4)}`,
    description: "A description used by admin moderation tests.",
    priceCents: 150_000,
    isNegotiable: false,
    condition: "GOOD",
    brand: null,
    quantity: 1,
    contactPreference: "ANY",
    county: "Nairobi",
    subCounty: null,
    status: "PENDING_REVIEW",
    viewCount: 0,
    favoriteCount: 0,
    isFeatured: false,
    publishedAt: null,
    createdAt: new Date("2026-01-05T00:00:00Z"),
    updatedAt: new Date("2026-01-05T00:00:00Z"),
    ...input,
    id,
    title,
  }) as unknown as SeededProduct;
}

export function seedOrder(
  store: FakeAdminStore,
  input: Overrides<{ id?: string; buyerId: string; sellerId: string }>
): SeededOrder {
  const id = (input.id as string | undefined) ?? randomUUID();
  return put(store, "orders", {
    orderNumber: `MH-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    status: "PENDING",
    subtotalCents: 150_000,
    totalCents: 150_000,
    deliveryCounty: null,
    deliveryAddress: null,
    notes: null,
    createdAt: new Date("2026-01-06T00:00:00Z"),
    updatedAt: new Date("2026-01-06T00:00:00Z"),
    ...input,
    id,
  }) as unknown as SeededOrder;
}

export function seedReport(store: FakeAdminStore, input: Overrides<{ id?: string; productId: string; reporterId: string }>): SeededReport {
  const id = (input.id as string | undefined) ?? randomUUID();
  return put(store, "reports", {
    reason: "SCAM",
    details: null,
    status: "OPEN",
    resolvedAt: null,
    createdAt: new Date("2026-01-07T00:00:00Z"),
    ...input,
    id,
  }) as unknown as SeededReport;
}

/** Reset every table + the operation log between tests. */
export function clearAdminStore(store: FakeAdminStore) {
  for (const table of Object.values(store.tables)) table.clear();
  store.operations.length = 0;
}
