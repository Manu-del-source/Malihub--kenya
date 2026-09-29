import { randomUUID } from "node:crypto";
import { PrismaKnownError } from "./fake-account-store";
import type { CartStore } from "@/services/cart-service";
import type { OrderStore, TransactionalOrderStore } from "@/services/order-service";

/**
 * An in-memory stand-in for the slice of Prisma the cart, order and listing
 * services use — the same role `fake-account-store.ts` plays for account
 * provisioning.
 *
 * It mirrors the Postgres behaviour the production code depends on:
 *  - `update`/`findUniqueOrThrow` on a missing row throws Prisma's `P2025`;
 *  - `cart_items (user_id, product_id)` and `wishlists (user_id, product_id)`
 *    are UNIQUE, so a second insert raises `P2002`;
 *  - `orders.order_number` is UNIQUE — a collision raises `P2002` and the
 *    checkout retry loop must survive it;
 *  - `updateMany` returns the *count* of rows that matched the WHERE clause,
 *    which is exactly how checkout asserts "this listing is still ACTIVE with
 *    enough stock" inside the transaction;
 *  - a failed `$transaction` (callback form) rolls every write back.
 *
 * `include`/`select` arguments are honoured only insofar as the code under
 * test reads them: relations the services actually touch (product images,
 * seller business names, buyer profiles, order items) are attached, anything
 * else is returned as-is — extra fields are harmless, missing ones are not.
 *
 * The delegate signatures below are deliberately loose (not Prisma's generic
 * ones): the fake is never a real `PrismaClient`, and tests cast it through
 * `asCartStore`/`asOrderStore` at the service boundary.
 */

/** Prisma-ish argument bags arrive untyped; every method casts what it reads. */
type Args = Record<string, unknown>;

export type ProductRow = {
  id: string;
  sellerId: string;
  ownerId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  priceCents: number;
  isNegotiable: boolean;
  condition: string;
  brand: string | null;
  quantity: number;
  contactPreference: string;
  county: string;
  subCounty: string | null;
  status: string;
  viewCount: number;
  favoriteCount: number;
  isFeatured: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CartItemRow = {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WishlistRow = { id: string; userId: string; productId: string; createdAt: Date };

export type SellerRow = {
  id: string;
  userId: string;
  businessName: string;
  slug: string;
  county: string;
  verificationStatus: string;
};

export type OrderRow = {
  id: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  status: string;
  subtotalCents: number;
  totalCents: number;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItemRow = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  createdAt: Date;
};

export type ProductImageRow = {
  id: string;
  productId: string;
  url: string;
  cloudinaryId: string;
  sortOrder: number;
  isPrimary: boolean;
};

export type CategoryRow = { id: string; name: string; slug: string };

export type ProfileRow = { userId: string; fullName: string; county: string | null };

export type Tables = {
  products: Map<string, ProductRow>;
  productImages: Map<string, ProductImageRow>;
  categories: Map<string, CategoryRow>;
  cartItems: Map<string, CartItemRow>;
  wishlists: Map<string, WishlistRow>;
  orders: Map<string, OrderRow>;
  orderItems: Map<string, OrderItemRow>;
  sellers: Map<string, SellerRow>;
  profiles: Map<string, ProfileRow>;
};

export type FakeMarketplaceStore = {
  tables: Tables;
  operations: string[];
  /** Set to make the NEXT `order.create` raise P2002 (order-number collision). */
  failNextOrderCreate: boolean;
  /** Set to make every `product.updateMany` guard fail (a "sold out mid-checkout" race). */
  forceUpdateManyMiss: boolean;
  /**
   * One-shot hook that runs the moment `$transaction` opens, BEFORE its
   * rollback snapshot is taken. Tests use it to simulate writes from a
   * concurrent transaction that committed in the window between the caller's
   * pre-transaction read and the transaction itself (e.g. a rival checkout
   * clearing the same cart). The hook's effects survive a rollback — the
   * rival's transaction was never ours to undo. Cleared after one fire.
   */
  beforeTransaction: (() => void) | null;
  cartItem: {
    findMany(args?: Args): Promise<unknown[]>;
    findUnique(args: Args): Promise<unknown>;
    create(args: Args): Promise<unknown>;
    update(args: Args): Promise<unknown>;
    updateMany(args: Args): Promise<{ count: number }>;
    deleteMany(args: Args): Promise<{ count: number }>;
  };
  product: {
    findUnique(args: Args): Promise<unknown>;
    findUniqueOrThrow(args: Args): Promise<unknown>;
    findMany(args?: Args): Promise<unknown[]>;
    update(args: Args): Promise<unknown>;
    updateMany(args: Args): Promise<{ count: number }>;
    count(args?: Args): Promise<number>;
    create(args: Args): Promise<unknown>;
  };
  order: {
    create(args: Args): Promise<unknown>;
    findMany(args?: Args): Promise<unknown[]>;
    findFirst(args: Args): Promise<unknown>;
    count(args?: Args): Promise<number>;
    aggregate(args?: Args): Promise<unknown>;
  };
  orderItem: {
    aggregate(args?: Args): Promise<unknown>;
  };
  seller: {
    findUnique(args: Args): Promise<unknown>;
  };
  profile: {
    findUnique(args: Args): Promise<unknown>;
  };
  category: {
    findUnique(args: Args): Promise<unknown>;
  };
  productImage: {
    deleteMany(args: Args): Promise<{ count: number }>;
  };
  wishlist: {
    findUnique(args: Args): Promise<unknown>;
    create(args: Args): Promise<unknown>;
    delete(args: Args): Promise<unknown>;
    findMany(args?: Args): Promise<unknown[]>;
  };
  $transaction<T>(arg: ((tx: FakeMarketplaceStore) => Promise<T>) | Promise<unknown>[]): Promise<T>;
};

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${(++seq).toString().padStart(4, "0")}`;

function matchesProductWhere(row: ProductRow, where: Args | undefined): boolean {
  if (!where) return true;
  if (typeof where.id === "string" && row.id !== where.id) return false;
  if (where.id && typeof where.id === "object") {
    const idWhere = where.id as { in?: string[]; not?: string };
    if (idWhere.in && !idWhere.in.includes(row.id)) return false;
    if (idWhere.not !== undefined && row.id !== idWhere.not) return false;
  }
  if (typeof where.sellerId === "string" && row.sellerId !== where.sellerId) return false;
  if (typeof where.ownerId === "string" && row.ownerId !== where.ownerId) return false;
  if (typeof where.status === "string" && row.status !== where.status) return false;
  if (where.status && typeof where.status === "object") {
    const statusWhere = where.status as { not?: string; in?: string[] };
    if (statusWhere.not !== undefined && row.status === statusWhere.not) return false;
    if (statusWhere.in && !statusWhere.in.includes(row.status)) return false;
  }
  if (where.quantity && typeof where.quantity === "object") {
    const q = where.quantity as { lte?: number; gte?: number };
    if (q.lte !== undefined && !(row.quantity <= q.lte)) return false;
    if (q.gte !== undefined && !(row.quantity >= q.gte)) return false;
  }
  return true;
}

function matchesOrderWhere(row: OrderRow, where: Args | undefined): boolean {
  if (!where) return true;
  if (typeof where.id === "string" && row.id !== where.id) return false;
  if (typeof where.buyerId === "string" && row.buyerId !== where.buyerId) return false;
  if (typeof where.sellerId === "string" && row.sellerId !== where.sellerId) return false;
  if (typeof where.status === "string" && row.status !== where.status) return false;
  if (where.status && typeof where.status === "object") {
    const s = where.status as { not?: string; in?: string[] };
    if (s.not !== undefined && row.status === s.not) return false;
    if (s.in && !s.in.includes(row.status)) return false;
  }
  return true;
}

export function createFakeMarketplaceStore(): FakeMarketplaceStore {
  const tables: Tables = {
    products: new Map(),
    productImages: new Map(),
    categories: new Map(),
    cartItems: new Map(),
    wishlists: new Map(),
    orders: new Map(),
    orderItems: new Map(),
    sellers: new Map(),
    profiles: new Map(),
  };

  // Rows are mutated in place, so the snapshot must clone every ROW, not just
  // re-wrap the Map — otherwise a rollback would restore a live view of the
  // already-mutated objects (the exact bug this fake exists to prevent).
  const snapshot = (): Record<string, Map<string, unknown>> => {
    const out: Record<string, Map<string, unknown>> = {};
    for (const [name, map] of Object.entries(tables)) {
      const copy = new Map<string, unknown>();
      for (const [key, row] of map as Map<string, object>) {
        copy.set(key, { ...row });
      }
      out[name] = copy;
    }
    return out;
  };

  const restore = (snap: Record<string, Map<string, unknown>>) => {
    for (const [name, map] of Object.entries(tables)) {
      map.clear();
      for (const [key, row] of snap[name]!.entries()) {
        (map as Map<string, unknown>).set(key, row);
      }
    }
  };

  const sellerByUserId = (userId: string): SellerRow | undefined =>
    [...tables.sellers.values()].find((s) => s.userId === userId);

  function attachProduct(product: ProductRow, takeImages?: number) {
    const images = [...tables.productImages.values()]
      .filter((img) => img.productId === product.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, takeImages ?? Number.POSITIVE_INFINITY);
    const seller = tables.sellers.get(product.sellerId);
    const category = tables.categories.get(product.categoryId);
    return {
      ...product,
      images,
      seller: seller
        ? {
            id: seller.id,
            businessName: seller.businessName,
            verificationStatus: seller.verificationStatus,
            slug: seller.slug,
          }
        : null,
      category: category ?? null,
    };
  }

  function assertCartUnique(userId: string, productId: string, ignoreId?: string) {
    for (const row of tables.cartItems.values()) {
      if (row.id === ignoreId) continue;
      if (row.userId === userId && row.productId === productId) {
        throw new PrismaKnownError(
          "P2002",
          "Unique constraint failed on cart_items.user_id, cart_items.product_id"
        );
      }
    }
  }

  function assertWishlistUnique(userId: string, productId: string) {
    for (const row of tables.wishlists.values()) {
      if (row.userId === userId && row.productId === productId) {
        throw new PrismaKnownError(
          "P2002",
          "Unique constraint failed on wishlists.user_id, wishlists.product_id"
        );
      }
    }
  }

  function merge(row: Record<string, unknown>, data: Args) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (key === "images" || key === "items") continue; // nested writes handled by callers
      if (value && typeof value === "object" && !(value instanceof Date)) {
        const v = value as { increment?: number; decrement?: number };
        if (v.increment !== undefined) {
          row[key] = (row[key] as number) + v.increment;
          continue;
        }
        if (v.decrement !== undefined) {
          row[key] = (row[key] as number) - v.decrement;
          continue;
        }
      }
      row[key] = value;
    }
  }

  function attachOrder(row: OrderRow, include: Args) {
    const out: Record<string, unknown> = { ...row };

    if (include.items) {
      const itemsInclude = (include.items as { include?: { product?: unknown } }).include;
      out.items = [...tables.orderItems.values()]
        .filter((item) => item.orderId === row.id)
        .map((item) => {
          const itemOut: Record<string, unknown> = { ...item };
          if (itemsInclude?.product) {
            const product = tables.products.get(item.productId);
            if (product) {
              itemOut.product = {
                ...product,
                images: [...tables.productImages.values()]
                  .filter((img) => img.productId === product.id)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .slice(0, 1),
              };
            }
          }
          return itemOut;
        });
    }

    if (include.seller) {
      const seller = tables.sellers.get(row.sellerId);
      out.seller = seller
        ? {
            id: seller.id,
            businessName: seller.businessName,
            slug: seller.slug,
            verificationStatus: seller.verificationStatus,
          }
        : null;
    }

    if (include.buyer) {
      const profile = tables.profiles.get(row.buyerId);
      out.buyer = { profile: profile ? { fullName: profile.fullName } : null };
    }

    return out;
  }

  const store: FakeMarketplaceStore = {
    tables,
    operations: [],
    failNextOrderCreate: false,
    forceUpdateManyMiss: false,
    beforeTransaction: null,

    cartItem: {
      async findMany(args = {}) {
        store.operations.push("cartItem.findMany");
        const where = (args.where ?? {}) as Args;
        const rows = [...tables.cartItems.values()].filter((row) => {
          if (typeof where.userId === "string" && row.userId !== where.userId) return false;
          if (where.product && typeof where.product === "object") {
            const product = tables.products.get(row.productId);
            const productWhere = where.product as { status?: string };
            if (productWhere.status && product?.status !== productWhere.status) return false;
          }
          return true;
        });

        if (args.include || args.select) {
          return rows.map((row) => {
            const product = tables.products.get(row.productId)!;
            return { ...row, product: attachProduct(product, 1) };
          });
        }
        return rows.map((row) => ({ ...row }));
      },
      async findUnique(args) {
        store.operations.push("cartItem.findUnique");
        const where = args.where as
          | { id?: string; userId_productId?: { userId: string; productId: string } }
          | undefined;
        for (const row of tables.cartItems.values()) {
          if (where?.id !== undefined && row.id !== where.id) continue;
          if (where?.userId_productId) {
            const key = where.userId_productId;
            if (row.userId !== key.userId || row.productId !== key.productId) continue;
          }
          return { ...row };
        }
        return null;
      },
      async create(args) {
        store.operations.push("cartItem.create");
        const data = args.data as { userId: string; productId: string; quantity?: number };
        assertCartUnique(data.userId, data.productId);
        const row: CartItemRow = {
          id: nextId("cart"),
          userId: data.userId,
          productId: data.productId,
          quantity: data.quantity ?? 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        tables.cartItems.set(row.id, row);
        return { ...row };
      },
      async update(args) {
        store.operations.push("cartItem.update");
        const where = args.where as { id?: string; userId_productId?: { userId: string; productId: string } };
        let target: CartItemRow | undefined;
        if (where.id !== undefined) {
          target = tables.cartItems.get(where.id);
        } else if (where.userId_productId) {
          const key = where.userId_productId;
          target = [...tables.cartItems.values()].find(
            (row) => row.userId === key.userId && row.productId === key.productId
          );
        }
        if (!target) throw new PrismaKnownError("P2025", "cart item to update not found");
        merge(target as unknown as Record<string, unknown>, args.data as Args);
        target.updatedAt = new Date();
        return { ...target };
      },
      async updateMany(args) {
        store.operations.push("cartItem.updateMany");
        const where = args.where as {
          userId?: string;
          productId?: string | { in: string[] };
        };
        let count = 0;
        for (const row of tables.cartItems.values()) {
          if (where.userId !== undefined && row.userId !== where.userId) continue;
          if (typeof where.productId === "string" && row.productId !== where.productId) continue;
          if (
            where.productId &&
            typeof where.productId === "object" &&
            !where.productId.in.includes(row.productId)
          )
            continue;
          merge(row as unknown as Record<string, unknown>, args.data as Args);
          row.updatedAt = new Date();
          count++;
        }
        return { count };
      },
      async deleteMany(args) {
        store.operations.push("cartItem.deleteMany");
        const where = args.where as {
          userId?: string;
          productId?: string | { in: string[] };
        };
        let count = 0;
        for (const [id, row] of [...tables.cartItems.entries()]) {
          if (where.userId !== undefined && row.userId !== where.userId) continue;
          if (typeof where.productId === "string" && row.productId !== where.productId) continue;
          if (
            where.productId &&
            typeof where.productId === "object" &&
            !where.productId.in.includes(row.productId)
          )
            continue;
          tables.cartItems.delete(id);
          count++;
        }
        return { count };
      },
    },

    product: {
      async findUnique(args) {
        store.operations.push("product.findUnique");
        const row = tables.products.get((args.where as { id: string }).id);
        if (!row) return null;
        const include = args.include as Args | undefined;
        if (include && (include.images || include.category || include.seller)) {
          return attachProduct(row);
        }
        return { ...row };
      },
      async findUniqueOrThrow(args) {
        store.operations.push("product.findUniqueOrThrow");
        const row = tables.products.get((args.where as { id: string }).id);
        if (!row) throw new PrismaKnownError("P2025", "product to update not found");
        return { ...row };
      },
      async findMany(args = {}) {
        store.operations.push("product.findMany");
        const where = args.where as Args | undefined;
        const rows = [...tables.products.values()].filter((row) =>
          matchesProductWhere(row, where)
        );
        const include = args.include as Args | undefined;
        const mapped = include
          ? rows.map((r) => attachProduct(r))
          : rows.map((r) => ({ ...r }));
        const take = args.take as number | undefined;
        return take !== undefined ? mapped.slice(0, take) : mapped;
      },
      async update(args) {
        store.operations.push("product.update");
        const row = tables.products.get((args.where as { id: string }).id);
        if (!row) throw new PrismaKnownError("P2025", "product to update not found");
        const data = args.data as Args;
        merge(row as unknown as Record<string, unknown>, data);

        const nestedImages = data.images as
          | { create?: Array<Record<string, unknown>> }
          | undefined;
        if (nestedImages?.create) {
          for (const [index, img] of nestedImages.create.entries()) {
            const imageRow: ProductImageRow = {
              id: nextId("img"),
              productId: row.id,
              url: String(img.url),
              cloudinaryId: String(img.cloudinaryId),
              sortOrder: typeof img.sortOrder === "number" ? img.sortOrder : index,
              isPrimary: Boolean(img.isPrimary),
            };
            tables.productImages.set(imageRow.id, imageRow);
          }
        }
        row.updatedAt = new Date();

        const include = args.include as Args | undefined;
        if (include && (include.images || include.category)) {
          return attachProduct(row);
        }
        return { ...row };
      },
      async updateMany(args) {
        store.operations.push("product.updateMany");
        if (store.forceUpdateManyMiss) return { count: 0 };
        const where = args.where as Args;
        const data = args.data as Args;
        let count = 0;
        for (const row of tables.products.values()) {
          if (!matchesProductWhere(row, where)) continue;
          merge(row as unknown as Record<string, unknown>, data);
          row.updatedAt = new Date();
          count++;
        }
        return { count };
      },
      async count(args = {}) {
        store.operations.push("product.count");
        const where = args.where as Args | undefined;
        return [...tables.products.values()].filter((row) =>
          matchesProductWhere(row, where)
        ).length;
      },
      async create(args) {
        store.operations.push("product.create");
        const data = args.data as Args & {
          images?: { create?: Array<Record<string, unknown>> };
        };
        const row: ProductRow = {
          // UUID on purpose: the API routes validate product ids with zod's
          // `.uuid()`, and this fake must clear the same gate a real row would.
          id: randomUUID(),
          sellerId: String(data.sellerId),
          ownerId: String(data.ownerId),
          categoryId: String(data.categoryId),
          title: String(data.title),
          slug: String(data.slug),
          description: String(data.description ?? ""),
          priceCents: Number(data.priceCents ?? 0),
          isNegotiable: Boolean(data.isNegotiable),
          condition: String(data.condition ?? "GOOD"),
          brand: (data.brand as string | null) ?? null,
          quantity: Number(data.quantity ?? 1),
          contactPreference: String(data.contactPreference ?? "ANY"),
          county: String(data.county ?? ""),
          subCounty: (data.subCounty as string | null) ?? null,
          status: String(data.status ?? "PENDING_REVIEW"),
          viewCount: 0,
          favoriteCount: 0,
          isFeatured: false,
          publishedAt: (data.publishedAt as Date | null) ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        for (const other of tables.products.values()) {
          if (other.slug === row.slug) {
            throw new PrismaKnownError("P2002", "Unique constraint failed on products.slug");
          }
        }
        tables.products.set(row.id, row);
        for (const [index, img] of (data.images?.create ?? []).entries()) {
          const imageRow: ProductImageRow = {
            id: nextId("img"),
            productId: row.id,
            url: String(img.url),
            cloudinaryId: String(img.cloudinaryId),
            sortOrder: typeof img.sortOrder === "number" ? img.sortOrder : index,
            isPrimary: Boolean(img.isPrimary),
          };
          tables.productImages.set(imageRow.id, imageRow);
        }
        return { ...row };
      },
    },

    order: {
      async create(args) {
        store.operations.push("order.create");
        if (store.failNextOrderCreate) {
          store.failNextOrderCreate = false;
          throw new PrismaKnownError("P2002", "Unique constraint failed on orders.order_number");
        }
        const data = args.data as Args & {
          orderNumber: string;
          items?: { create?: Array<Record<string, unknown>> };
        };
        for (const other of tables.orders.values()) {
          if (other.orderNumber === data.orderNumber) {
            throw new PrismaKnownError("P2002", "Unique constraint failed on orders.order_number");
          }
        }
        const row: OrderRow = {
          id: nextId("ord"),
          orderNumber: data.orderNumber,
          buyerId: String(data.buyerId),
          sellerId: String(data.sellerId),
          status: String(data.status ?? "PENDING"),
          subtotalCents: Number(data.subtotalCents ?? 0),
          totalCents: Number(data.totalCents ?? 0),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        tables.orders.set(row.id, row);

        for (const item of data.items?.create ?? []) {
          const itemRow: OrderItemRow = {
            id: nextId("oi"),
            orderId: row.id,
            productId: String(item.productId),
            quantity: Number(item.quantity ?? 1),
            unitPriceCents: Number(item.unitPriceCents ?? 0),
            totalCents: Number(item.totalCents ?? 0),
            createdAt: new Date(),
          };
          tables.orderItems.set(itemRow.id, itemRow);
        }
        return { ...row };
      },
      async findMany(args = {}) {
        store.operations.push("order.findMany");
        const where = args.where as Args | undefined;
        const include = args.include as Args | undefined;
        const rows = [...tables.orders.values()]
          .filter((row) => matchesOrderWhere(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (!include) return rows.map((r) => ({ ...r }));
        return rows.map((row) => attachOrder(row, include));
      },
      async findFirst(args) {
        store.operations.push("order.findFirst");
        const where = args.where as Args | undefined;
        const include = args.include as Args | undefined;
        const row = [...tables.orders.values()].find((r) => matchesOrderWhere(r, where));
        if (!row) return null;
        return include ? attachOrder(row, include) : { ...row };
      },
      async count(args = {}) {
        store.operations.push("order.count");
        const where = args.where as Args | undefined;
        return [...tables.orders.values()].filter((row) => matchesOrderWhere(row, where)).length;
      },
      async aggregate(args = {}) {
        store.operations.push("order.aggregate");
        const where = args.where as Args | undefined;
        const sum = (args._sum ?? {}) as Record<string, boolean>;
        const rows = [...tables.orders.values()].filter((row) => matchesOrderWhere(row, where));
        const result: Record<string, number | null> = {};
        if (sum.totalCents) {
          result.totalCents = rows.reduce((total, row) => total + row.totalCents, 0);
        }
        return { _sum: result };
      },
    },

    orderItem: {
      async aggregate(args = {}) {
        store.operations.push("orderItem.aggregate");
        const where = (args.where ?? {}) as { order?: Args };
        const orderWhere = where.order ?? {};
        const sum = (args._sum ?? {}) as Record<string, boolean>;
        let quantity: number | null = null;
        if (sum.quantity) {
          quantity = 0;
          for (const item of tables.orderItems.values()) {
            const order = tables.orders.get(item.orderId);
            if (!order || !matchesOrderWhere(order, orderWhere)) continue;
            quantity += item.quantity;
          }
        }
        return { _sum: { quantity } };
      },
    },

    seller: {
      async findUnique(args) {
        store.operations.push("seller.findUnique");
        const userId = (args.where as { userId: string }).userId;
        const row = sellerByUserId(userId);
        return row ? { ...row } : null;
      },
    },

    profile: {
      async findUnique(args) {
        store.operations.push("profile.findUnique");
        const row = tables.profiles.get((args.where as { userId: string }).userId);
        return row ? { ...row } : null;
      },
    },

    category: {
      async findUnique(args) {
        const slug = (args.where as { slug: string }).slug;
        for (const row of tables.categories.values()) {
          if (row.slug === slug) return { ...row };
        }
        return null;
      },
    },

    productImage: {
      async deleteMany(args) {
        store.operations.push("productImage.deleteMany");
        const productId = (args.where as { productId: string }).productId;
        let count = 0;
        for (const [id, row] of [...tables.productImages.entries()]) {
          if (row.productId !== productId) continue;
          tables.productImages.delete(id);
          count++;
        }
        return { count };
      },
    },

    wishlist: {
      async findUnique(args) {
        store.operations.push("wishlist.findUnique");
        const where = args.where as {
          id?: string;
          userId_productId?: { userId: string; productId: string };
        };
        for (const row of tables.wishlists.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.userId_productId) {
            const key = where.userId_productId;
            if (row.userId !== key.userId || row.productId !== key.productId) continue;
          }
          return { ...row };
        }
        return null;
      },
      async create(args) {
        store.operations.push("wishlist.create");
        const data = args.data as { userId: string; productId: string };
        assertWishlistUnique(data.userId, data.productId);
        const row: WishlistRow = {
          id: nextId("wish"),
          userId: data.userId,
          productId: data.productId,
          createdAt: new Date(),
        };
        tables.wishlists.set(row.id, row);
        return { ...row };
      },
      async delete(args) {
        store.operations.push("wishlist.delete");
        const id = (args.where as { id: string }).id;
        const row = tables.wishlists.get(id);
        if (!row) throw new PrismaKnownError("P2025", "wishlist row to delete not found");
        tables.wishlists.delete(id);
        return { ...row };
      },
      async findMany(args = {}) {
        store.operations.push("wishlist.findMany");
        const userId = (args.where as { userId?: string } | undefined)?.userId;
        return [...tables.wishlists.values()]
          .filter((row) => (userId ? row.userId === userId : true))
          .map((row) => ({ ...row }));
      },
    },

    async $transaction<T>(arg: ((tx: FakeMarketplaceStore) => Promise<T>) | Promise<unknown>[]) {
      store.operations.push("$transaction");
      if (Array.isArray(arg)) {
        // List form: the promises were created eagerly (mirroring how the
        // services build them) — just await them.
        await Promise.all(arg);
        return undefined as T;
      }
      if (store.beforeTransaction) {
        const hook = store.beforeTransaction;
        store.beforeTransaction = null;
        hook();
      }
      const snap = snapshot();
      const opCount = store.operations.length;
      try {
        return await arg(store);
      } catch (error) {
        restore(snap);
        store.operations.length = opCount;
        throw error;
      }
    },
  };

  return store;
}

/** Casts the fake onto the Prisma-shaped interfaces the services expect. */
export function asCartStore(store: FakeMarketplaceStore): CartStore {
  return store as unknown as CartStore;
}

export function asOrderStore(
  store: FakeMarketplaceStore
): OrderStore & TransactionalOrderStore {
  return store as unknown as OrderStore & TransactionalOrderStore;
}

// ─── Seed helpers ──────────────────────────────────────────────────────────

export function seedCategory(store: FakeMarketplaceStore, slug = "electronics"): CategoryRow {
  const row: CategoryRow = { id: nextId("cat"), name: slug, slug };
  store.tables.categories.set(row.id, row);
  return row;
}

export function seedSeller(
  store: FakeMarketplaceStore,
  overrides: Partial<SellerRow> & { userId: string }
): SellerRow {
  const row: SellerRow = {
    id: overrides.id ?? nextId("seller"),
    userId: overrides.userId,
    businessName: overrides.businessName ?? "Test Shop",
    slug: overrides.slug ?? `shop-${randomUUID().slice(0, 8)}`,
    county: overrides.county ?? "Nairobi",
    verificationStatus: overrides.verificationStatus ?? "VERIFIED",
  };
  store.tables.sellers.set(row.id, row);
  return row;
}

export function seedProduct(
  store: FakeMarketplaceStore,
  overrides: Partial<ProductRow> & { sellerId: string; ownerId: string; categoryId: string }
): ProductRow {
  const row: ProductRow = {
    id: overrides.id ?? randomUUID(),
    sellerId: overrides.sellerId,
    ownerId: overrides.ownerId,
    categoryId: overrides.categoryId,
    title: overrides.title ?? "Test listing",
    slug: overrides.slug ?? `test-listing-${randomUUID().slice(0, 8)}`,
    description: overrides.description ?? "A listing used by the test suite.",
    priceCents: overrides.priceCents ?? 150_000,
    isNegotiable: overrides.isNegotiable ?? false,
    condition: overrides.condition ?? "GOOD",
    brand: overrides.brand ?? null,
    quantity: overrides.quantity ?? 5,
    contactPreference: overrides.contactPreference ?? "ANY",
    county: overrides.county ?? "Nairobi",
    subCounty: overrides.subCounty ?? null,
    status: overrides.status ?? "ACTIVE",
    viewCount: overrides.viewCount ?? 0,
    favoriteCount: overrides.favoriteCount ?? 0,
    isFeatured: overrides.isFeatured ?? false,
    publishedAt: overrides.publishedAt ?? new Date(),
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
  store.tables.products.set(row.id, row);
  return row;
}

export function seedProfile(
  store: FakeMarketplaceStore,
  userId: string,
  fullName = "Emmanuel Yegon"
): ProfileRow {
  const row: ProfileRow = { userId, fullName, county: "Uasin Gishu" };
  store.tables.profiles.set(userId, row);
  return row;
}

export function seedCartItem(
  store: FakeMarketplaceStore,
  userId: string,
  productId: string,
  quantity = 1
): CartItemRow {
  const row: CartItemRow = {
    id: nextId("cart"),
    userId,
    productId,
    quantity,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  store.tables.cartItems.set(row.id, row);
  return row;
}
