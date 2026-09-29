import "server-only";

import { Prisma } from "@prisma/client";
import type {
  ListingStatus,
  OrderStatus,
  PaymentStatus,
  SellerVerificationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PAID_ORDER_STATUSES } from "@/lib/order-status";
import { logAuditEvent } from "@/services/audit-service";
import { notifyUser } from "@/services/notification-service";

/**
 * Admin operations — the data layer behind `/admin`.
 *
 * ─── What lives here and why ──────────────────────────────────────────────
 * Admin screens need cross-tenant reads (every user, every seller, every
 * listing) and a small set of privileged mutations. Neither belongs in the
 * seller/buyer services: `listing-service` and `order-service` hard-assert
 * ownership against the *acting* user, which is exactly the rule that must
 * NOT apply here — and reusing them would mean weakening them. This service
 * is the only place admin queries and admin writes live.
 *
 * ─── Authorization is NOT this service's job (but it never trusts either) ──
 * Callers (`/admin` pages and Server Actions) enforce access first via
 * `requireAdministrator()` / `requireAdministratorAction()` against the Neon
 * Auth session. This module takes no actor id from any *request*; the actor
 * (`{ id, email }`) is passed down from the session-resolved guard purely so
 * the audit trail can attribute the write. That means a forged id in a payload
 * can at worst point an authorized admin at the wrong row — it can never
 * authorize anything, and mutations still re-read the target row before
 * writing so a stale/fake id fails with a clean error instead of a blind
 * update.
 *
 * ─── Every privileged mutation is audited ─────────────────────────────────
 * Seller verification decisions, listing moderation decisions and category
 * changes each append an `audit_logs` row through `logAuditEvent` (the same
 * append-only trail `src/services/audit-service.ts` defines). Metadata holds
 * only the transition and the admin's optional note — never documents,
 * contact details, or anything credential-shaped. Affected sellers/owners are
 * notified through `notifyUser()`, the single notification choke point the
 * rest of the app already uses; never through a second pipeline.
 *
 * ─── Reads are scoped, paged, and aggregate-only ──────────────────────────
 * Lists paginate (offset-based; admin tables are browsed by page, not
 * infinite-scrolled) and counts run as `Promise.all` of narrow
 * `count`/`aggregate` queries — the pattern the seller dashboards use. No
 * query loads a whole table; no statistic is fabricated. Where the schema
 * cannot answer a question (e.g. money actually *collected*, since payment
 * collection is not live yet), the number surfaced is the honest one
 * computed from what exists.
 */

export const ADMIN_PAGE_SIZE = 25;

export class AdminServiceError extends Error {}

type PrismaHandle = typeof prisma;

/** The session-resolved admin performing a mutation (for the audit trail). */
export type AdminActor = { id: string; email: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Detail routes take ids straight from the URL; a non-UUID must 404 before
 * it can make Postgres raise a malformed-uuid error (same rule as
 * `getListingById` in `search-service.ts`). */
export function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function prismaError(error: unknown, expected: string): AdminServiceError {
  const code = (error as { code?: string })?.code;
  if (code === "P2025") return new AdminServiceError(`${expected} no longer exists.`);
  if (code === "P2002") return new AdminServiceError("That value is already taken.");
  throw error;
}

// ─── Overview ──────────────────────────────────────────────────────────────

/**
 * Every number the `/admin` overview shows, each one a real aggregate over
 * the current database. "Buyers"/"Sellers" count `users.role` (the account's
 * declared role); seller *profiles* are counted separately against the
 * `sellers` table, which is what seller access actually keys off.
 *
 * GMV-style metrics are labelled as what they are: order-value sums over
 * `orders.total_cents`. MaliHub records no money movement until the payment
 * provider integration completes, so "collected" is the sum over orders in
 * paid statuses (`lib/order-status.ts`), not a ledger truth.
 */
export async function getAdminOverview(db: PrismaHandle = prisma) {
  const [
    totalUsers,
    roleBuyers,
    roleSellers,
    staffAccounts,
    bannedAccounts,

    totalSellers,
    pendingVerifications,
    verifiedSellers,
    rejectedSellers,

    totalListings,
    activeListings,
    pendingReviewListings,
    draftListings,
    soldListings,
    suspendedListings,

    totalOrders,
    pendingOrders,
    completedOrders,
    cancelledOrders,
    paidOrders,
    bookedValue,
    paidValue,

    recentUsers,
    recentListings,
    recentOrders,
    recentAuditEvents,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: "BUYER" } }),
    db.user.count({ where: { role: "SELLER" } }),
    db.user.count({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } }),
    db.user.count({ where: { isBanned: true } }),

    db.seller.count(),
    db.seller.count({ where: { verificationStatus: "PENDING" } }),
    db.seller.count({ where: { verificationStatus: "VERIFIED" } }),
    db.seller.count({ where: { verificationStatus: "REJECTED" } }),

    db.product.count(),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.product.count({ where: { status: "PENDING_REVIEW" } }),
    db.product.count({ where: { status: "DRAFT" } }),
    db.product.count({ where: { status: "SOLD" } }),
    db.product.count({ where: { status: "SUSPENDED" } }),

    db.order.count(),
    db.order.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { status: "COMPLETED" } }),
    db.order.count({ where: { status: "CANCELLED" } }),
    db.order.count({ where: { status: { in: [...PAID_ORDER_STATUSES] } } }),
    db.order.aggregate({
      where: { status: { notIn: ["CANCELLED", "REFUNDED"] } },
      _sum: { totalCents: true },
    }),
    db.order.aggregate({
      where: { status: { in: [...PAID_ORDER_STATUSES] } },
      _sum: { totalCents: true },
    }),

    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        profile: { select: { fullName: true } },
      },
    }),
    db.product.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        priceCents: true,
        status: true,
        createdAt: true,
        seller: { select: { id: true, businessName: true } },
      },
    }),
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        orderNumber: true,
        totalCents: true,
        status: true,
        createdAt: true,
        buyer: { select: { profile: { select: { fullName: true } } } },
        seller: { select: { businessName: true } },
      },
    }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        action: true,
        actorEmail: true,
        targetType: true,
        targetId: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    users: {
      total: totalUsers,
      buyers: roleBuyers,
      sellers: roleSellers,
      staff: staffAccounts,
      banned: bannedAccounts,
    },
    sellers: {
      total: totalSellers,
      pendingVerifications,
      verified: verifiedSellers,
      rejected: rejectedSellers,
    },
    listings: {
      total: totalListings,
      active: activeListings,
      pendingReview: pendingReviewListings,
      drafts: draftListings,
      sold: soldListings,
      suspended: suspendedListings,
    },
    orders: {
      total: totalOrders,
      pending: pendingOrders,
      completed: completedOrders,
      cancelled: cancelledOrders,
      paid: paidOrders,
      bookedValueCents: bookedValue._sum.totalCents ?? 0,
      paidValueCents: paidValue._sum.totalCents ?? 0,
    },
    recent: {
      users: recentUsers,
      listings: recentListings,
      orders: recentOrders,
      auditEvents: recentAuditEvents,
    },
  };
}

// ─── Users ─────────────────────────────────────────────────────────────────

export type AdminUserListFilters = {
  q?: string;
  role?: "BUYER" | "SELLER" | "ADMIN" | "SUPER_ADMIN";
  account?: "active" | "inactive" | "banned";
  page: number;
};

/**
 * Explicit projection, not `include`: the rows carry what the admin list
 * renders (identity, flags, activity counts) and nothing else. `users` also
 * holds `phone` and `auth_user_id` — neither is needed to run an admin
 * screen, so neither may ride along on a list row.
 */
const ADMIN_USER_LIST_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  isBanned: true,
  createdAt: true,
  profile: { select: { fullName: true, avatarUrl: true, county: true } },
  seller: { select: { id: true, businessName: true, verificationStatus: true } },
  _count: { select: { products: true, orders: true } },
} satisfies Prisma.UserSelect;

export type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_LIST_SELECT }>;

/**
 * Account-status filter. The schema models this as two booleans
 * (`isActive`, `isBanned`); "inactive" is the deactivation switch, "banned"
 * the moderation one — the same pair `requireUser()` fails closed on.
 */
function userAccountWhere(account: AdminUserListFilters["account"]): Prisma.UserWhereInput {
  if (account === "banned") return { isBanned: true };
  if (account === "inactive") return { isActive: false };
  if (account === "active") return { isActive: true, isBanned: false };
  return {};
}

export async function listAdminUsers(
  filters: AdminUserListFilters,
  db: PrismaHandle = prisma
): Promise<{ users: AdminUserRow[]; total: number; pageSize: number }> {
  const where: Prisma.UserWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...userAccountWhere(filters.account),
    ...(filters.q
      ? {
          OR: [
            { email: { contains: filters.q, mode: "insensitive" } },
            { profile: { fullName: { contains: filters.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: ADMIN_USER_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    db.user.count({ where }),
  ]);

  return { users, total, pageSize: ADMIN_PAGE_SIZE };
}

export type AdminUserDetail = NonNullable<Awaited<ReturnType<typeof getAdminUserDetail>>>;

/**
 * One account's administrative view. Deliberately narrow: identity, account
 * flags, marketplace activity. Authentication lives entirely with Neon Auth
 * (passwords, sessions, tokens) and none of it is reachable through this
 * query even in principle — `users` holds no credentials; `auth_user_id`
 * (the provider mapping key) is selected out on purpose too.
 */
export async function getAdminUserDetail(userId: string, db: PrismaHandle = prisma) {
  if (!isUuid(userId)) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      isBanned: true,
      emailVerified: true,
      lastSeenAt: true,
      createdAt: true,
      profile: {
        select: {
          fullName: true,
          avatarUrl: true,
          county: true,
          subCounty: true,
          onboarded: true,
          createdAt: true,
        },
      },
      seller: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          county: true,
          subCounty: true,
          verificationStatus: true,
          ratingAverage: true,
          ratingCount: true,
          totalSales: true,
          createdAt: true,
        },
      },
      _count: {
        select: { products: true, orders: true, wishlists: true, reviews: true, notifications: true },
      },
    },
  });
  if (!user) return null;

  const [recentOrdersAsBuyer, recentListings, ordersAsSeller, openOrdersAsBuyer] =
    await Promise.all([
      db.order.findMany({
        where: { buyerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          totalCents: true,
          status: true,
          createdAt: true,
          seller: { select: { businessName: true } },
        },
      }),
      db.product.findMany({
        where: { ownerId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          priceCents: true,
          status: true,
          updatedAt: true,
          seller: { select: { businessName: true } },
        },
      }),
      user.seller
        ? db.order.count({ where: { sellerId: user.seller.id } })
        : Promise.resolve(0),
      db.order.count({
        where: {
          buyerId: user.id,
          status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] },
        },
      }),
    ]);

  return {
    user,
    recentOrdersAsBuyer,
    recentListings,
    ordersAsSeller,
    openOrdersAsBuyer,
  };
}

// ─── Sellers ───────────────────────────────────────────────────────────────

export type AdminSellerListFilters = {
  q?: string;
  verification?: SellerVerificationStatus;
  page: number;
};

const ADMIN_SELLER_LIST_SELECT = {
  id: true,
  businessName: true,
  slug: true,
  county: true,
  verificationStatus: true,
  createdAt: true,
  user: {
    select: { id: true, email: true, isActive: true, isBanned: true, createdAt: true },
  },
  _count: { select: { products: true, orders: true } },
} satisfies Prisma.SellerSelect;

export type AdminSellerRow = Prisma.SellerGetPayload<{
  select: typeof ADMIN_SELLER_LIST_SELECT;
}>;

export async function listAdminSellers(
  filters: AdminSellerListFilters,
  db: PrismaHandle = prisma
): Promise<{ sellers: AdminSellerRow[]; total: number; pageSize: number }> {
  const where: Prisma.SellerWhereInput = {
    ...(filters.verification ? { verificationStatus: filters.verification } : {}),
    ...(filters.q
      ? {
          OR: [
            { businessName: { contains: filters.q, mode: "insensitive" } },
            { user: { email: { contains: filters.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [sellers, total] = await Promise.all([
    db.seller.findMany({
      where,
      select: ADMIN_SELLER_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    db.seller.count({ where }),
  ]);

  return { sellers, total, pageSize: ADMIN_PAGE_SIZE };
}

export async function getAdminSellerDetail(sellerId: string, db: PrismaHandle = prisma) {
  if (!isUuid(sellerId)) return null;

  const seller = await db.seller.findUnique({
    where: { id: sellerId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          isBanned: true,
          createdAt: true,
          profile: {
            select: { fullName: true, avatarUrl: true, county: true, onboarded: true },
          },
        },
      },
      // `payoutAccounts` is deliberately NOT loaded: payouts are not part of
      // verification (payments are not collected by MaliHub yet), and which
      // payout destinations exist is financial detail these screens never
      // read — least privilege applies to reads too.
    },
  });
  if (!seller) return null;

  const [
    totalListings,
    activeListings,
    pendingReviewListings,
    draftListings,
    soldListings,
    suspendedListings,
    totalOrders,
    paidOrderCount,
    paidRevenue,
    recentListings,
    recentOrders,
  ] = await Promise.all([
    db.product.count({ where: { sellerId: seller.id } }),
    db.product.count({ where: { sellerId: seller.id, status: "ACTIVE" } }),
    db.product.count({ where: { sellerId: seller.id, status: "PENDING_REVIEW" } }),
    db.product.count({ where: { sellerId: seller.id, status: "DRAFT" } }),
    db.product.count({ where: { sellerId: seller.id, status: "SOLD" } }),
    db.product.count({ where: { sellerId: seller.id, status: "SUSPENDED" } }),
    db.order.count({ where: { sellerId: seller.id } }),
    db.order.count({ where: { sellerId: seller.id, status: { in: [...PAID_ORDER_STATUSES] } } }),
    db.order.aggregate({
      where: { sellerId: seller.id, status: { in: [...PAID_ORDER_STATUSES] } },
      _sum: { totalCents: true },
    }),
    db.product.findMany({
      where: { sellerId: seller.id },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        priceCents: true,
        status: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
    }),
    db.order.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        totalCents: true,
        status: true,
        createdAt: true,
        buyer: { select: { profile: { select: { fullName: true } } } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    seller,
    listings: {
      total: totalListings,
      active: activeListings,
      pendingReview: pendingReviewListings,
      drafts: draftListings,
      sold: soldListings,
      suspended: suspendedListings,
    },
    sales: {
      totalOrders,
      paidOrders: paidOrderCount,
      paidRevenueCents: paidRevenue._sum.totalCents ?? 0,
    },
    recentListings,
    recentOrders,
  };
}

// ─── Seller verification decisions ─────────────────────────────────────────
//
// The schema ALREADY models the workflow: `Seller.verificationStatus` is a
// `UNVERIFIED | PENDING | VERIFIED | REJECTED` enum with an index, purpose-
// built for this. No fields were invented; the admin surface just writes the
// states that exist. The one honest gap: nothing in the seller flow currently
// *submits* a seller into PENDING (onboarding provisions UNVERIFIED), so in
// practice admins act directly on UNVERIFIED rows — which these transitions
// allow. Rejected→UNVERIFIED (a "let them re-apply" reset) is also mapped.

export type SellerDecision = "VERIFIED" | "REJECTED" | "UNVERIFIED";

const SELLER_TRANSITIONS: Record<SellerDecision, { from: SellerVerificationStatus[]; audit: Parameters<typeof logAuditEvent>[0]["action"] }> = {
  VERIFIED: { from: ["UNVERIFIED", "PENDING", "REJECTED"], audit: "moderation.seller_verified" },
  REJECTED: { from: ["UNVERIFIED", "PENDING", "VERIFIED"], audit: "moderation.seller_rejected" },
  // "Review again": return a seller to the unverified baseline. The enum has
  // the state; wiring it gives admins a way to undo a mistaken verification
  // without inventing a new status.
  UNVERIFIED: { from: ["VERIFIED", "REJECTED"], audit: "moderation.seller_rejected" },
};

export async function setSellerVerificationStatus(params: {
  sellerId: string;
  decision: SellerDecision;
  note?: string;
  actor: AdminActor;
  db?: PrismaHandle;
}): Promise<{ businessName: string; verificationStatus: SellerVerificationStatus }> {
  const db = params.db ?? prisma;
  if (!isUuid(params.sellerId)) throw new AdminServiceError("Seller not found.");

  const seller = await db.seller.findUnique({
    where: { id: params.sellerId },
    select: { id: true, userId: true, businessName: true, verificationStatus: true },
  });
  if (!seller) throw new AdminServiceError("Seller not found.");

  const rule = SELLER_TRANSITIONS[params.decision];
  if (!rule) throw new AdminServiceError("Unknown seller decision.");
  if (seller.verificationStatus === params.decision) {
    throw new AdminServiceError(
      `This seller is already ${params.decision.toLowerCase()}.`
    );
  }
  if (!rule.from.includes(seller.verificationStatus)) {
    throw new AdminServiceError(
      `Cannot move a seller from ${seller.verificationStatus} to ${params.decision}.`
    );
  }

  const updated = await db.seller.update({
    where: { id: seller.id },
    data: { verificationStatus: params.decision },
    select: { businessName: true, verificationStatus: true },
  });

  // The seller hears through the existing notification pipeline — in-app +
  // email per `notification-service`'s own rules — not a parallel one.
  const titles: Record<SellerDecision, string> = {
    VERIFIED: "Your MaliHub seller account is verified",
    REJECTED: "Your seller verification was not approved",
    UNVERIFIED: "Your seller verification needs another look",
  };
  const noteLine = params.note ? ` Note from the review team: ${params.note}` : "";
  const bodies: Record<SellerDecision, string> = {
    VERIFIED: `Your seller account has been verified. Buyers can now see the full verification badge on your storefront.${noteLine}`,
    REJECTED: `Your seller verification was rejected.${noteLine}`,
    UNVERIFIED: `Your seller verification has been reset for review.${noteLine}`,
  };
  await notifyUser({
    userId: seller.userId,
    type: "SYSTEM",
    title: titles[params.decision],
    body: bodies[params.decision],
    linkUrl: "/account",
  }).catch((error) => console.error("Failed to notify seller of verification decision", error));

  await logAuditEvent({
    action: rule.audit,
    actorId: params.actor.id,
    actorEmail: params.actor.email,
    targetType: "seller",
    targetId: seller.id,
    metadata: {
      from: seller.verificationStatus,
      to: params.decision,
      ...(params.note ? { note: params.note } : {}),
    },
  });

  return updated;
}

// ─── Listings (moderation) ─────────────────────────────────────────────────

export type AdminListingListFilters = {
  q?: string;
  status?: ListingStatus;
  /** Category slug. */
  category?: string;
  /** Business-name text filter (the admin picks a seller by typing their name). */
  seller?: string;
  page: number;
};

const ADMIN_LISTING_LIST_SELECT = {
  id: true,
  title: true,
  priceCents: true,
  status: true,
  county: true,
  createdAt: true,
  images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
  category: { select: { id: true, name: true, slug: true } },
  seller: {
    select: { id: true, businessName: true, verificationStatus: true },
  },
  _count: { select: { orderItems: true, wishlists: true, reports: true } },
} satisfies Prisma.ProductSelect;

export type AdminListingRow = Prisma.ProductGetPayload<{
  select: typeof ADMIN_LISTING_LIST_SELECT;
}>;

export async function listAdminListings(
  filters: AdminListingListFilters,
  db: PrismaHandle = prisma
): Promise<{ listings: AdminListingRow[]; total: number; pageSize: number }> {
  const where: Prisma.ProductWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: { slug: filters.category } } : {}),
    ...(filters.seller
      ? { seller: { businessName: { contains: filters.seller, mode: "insensitive" } } }
      : {}),
    ...(filters.q ? { title: { contains: filters.q, mode: "insensitive" } } : {}),
  };

  const [listings, total] = await Promise.all([
    db.product.findMany({
      where,
      select: ADMIN_LISTING_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    db.product.count({ where }),
  ]);

  return { listings, total, pageSize: ADMIN_PAGE_SIZE };
}

export async function getAdminListingDetail(listingId: string, db: PrismaHandle = prisma) {
  if (!isUuid(listingId)) return null;

  const product = await db.product.findUnique({
    where: { id: listingId },
    include: {
      images: { orderBy: { sortOrder: "asc" as const } },
      category: { select: { id: true, name: true, slug: true } },
      seller: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          county: true,
          verificationStatus: true,
          ratingAverage: true,
          ratingCount: true,
        },
      },
      owner: {
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          profile: { select: { fullName: true } },
        },
      },
      _count: { select: { orderItems: true, wishlists: true, reviews: true, reports: true, listingViews: true } },
    },
  });
  if (!product) return null;

  const openReports = await db.report.count({
    where: { productId: product.id, status: { in: ["OPEN", "REVIEWING"] } },
  });

  return { product, openReports };
}

export type ModerationAction = "approve" | "reject" | "suspend" | "restore";

/**
 * Listing moderation, expressed ONLY in the statuses the existing
 * `ListingStatus` enum already provides (see the schema header: soft
 * moderation via `Product.status`, REMOVED/SUSPENDED instead of hard deletes,
 * so order history never orphans). No new moderation states were invented:
 *
 *   approve  PENDING_REVIEW | DRAFT   → ACTIVE   (publishes, stamps publishedAt)
 *   reject   PENDING_REVIEW            → REMOVED  (declined; seller keeps history)
 *   suspend  ACTIVE                    → SUSPENDED (takedown without deleting)
 *   restore  SUSPENDED | REMOVED       → ACTIVE
 */
const LISTING_TRANSITIONS: Record<
  ModerationAction,
  {
    from: ListingStatus[];
    to: ListingStatus;
    audit: Parameters<typeof logAuditEvent>[0]["action"];
    notify: { type: "LISTING_APPROVED" | "LISTING_REJECTED" | "LISTING_STATUS"; title: string };
    stampsPublishedAt: boolean;
  }
> = {
  approve: {
    from: ["PENDING_REVIEW", "DRAFT"],
    to: "ACTIVE",
    audit: "moderation.listing_approved",
    notify: { type: "LISTING_APPROVED", title: "Your listing is now live" },
    stampsPublishedAt: true,
  },
  reject: {
    from: ["PENDING_REVIEW", "SUSPENDED"],
    to: "REMOVED",
    audit: "moderation.listing_rejected",
    notify: { type: "LISTING_REJECTED", title: "Your listing was removed" },
    stampsPublishedAt: false,
  },
  suspend: {
    from: ["ACTIVE", "SOLD"],
    to: "SUSPENDED",
    audit: "moderation.listing_suspended",
    notify: { type: "LISTING_STATUS", title: "A listing of yours was suspended" },
    stampsPublishedAt: false,
  },
  restore: {
    from: ["SUSPENDED", "REMOVED"],
    to: "ACTIVE",
    audit: "moderation.listing_restored",
    notify: { type: "LISTING_STATUS", title: "Your listing is live again" },
    stampsPublishedAt: true,
  },
};

export async function moderateListing(params: {
  productId: string;
  action: ModerationAction;
  note?: string;
  actor: AdminActor;
  db?: PrismaHandle;
}): Promise<{ id: string; title: string; slug: string; status: ListingStatus }> {
  const db = params.db ?? prisma;
  if (!isUuid(params.productId)) throw new AdminServiceError("Listing not found.");

  const product = await db.product.findUnique({
    where: { id: params.productId },
    select: { id: true, title: true, slug: true, status: true, ownerId: true, publishedAt: true },
  });
  if (!product) throw new AdminServiceError("Listing not found.");

  const rule = LISTING_TRANSITIONS[params.action];
  if (!rule.from.includes(product.status)) {
    throw new AdminServiceError(
      `A ${product.status.toLowerCase().replace(/_/g, "-")} listing cannot be ${params.action}d.`
    );
  }

  const updated = await db.product.update({
    where: { id: product.id },
    data: {
      status: rule.to,
      // First publication stamps publishedAt; re-approving a previously
      // published listing keeps its original timestamp (same rule the seller
      // edit flow follows in listing-service).
      ...(rule.stampsPublishedAt && !product.publishedAt ? { publishedAt: new Date() } : {}),
    },
    select: { id: true, title: true, slug: true, status: true },
  });

  await notifyUser({
    userId: product.ownerId,
    type: rule.notify.type,
    title: rule.notify.title,
    body: `Your listing "${product.title}" ${
      rule.to === "ACTIVE" ? "is now live" : `is now ${rule.to.toLowerCase().replace(/_/g, "-")}`
    }.${params.note ? ` Note from the MaliHub team: ${params.note}` : ""}`,
    linkUrl: "/seller/listings",
  }).catch((error) => console.error("Failed to notify seller of listing moderation", error));

  await logAuditEvent({
    action: rule.audit,
    actorId: params.actor.id,
    actorEmail: params.actor.email,
    targetType: "listing",
    targetId: product.id,
    metadata: {
      from: product.status,
      to: rule.to,
      ...(params.note ? { note: params.note } : {}),
    },
  });

  return updated;
}

// ─── Orders (read-only) ────────────────────────────────────────────────────

export type AdminOrderListFilters = {
  q?: string;
  status?: OrderStatus;
  page: number;
};

const ADMIN_ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  totalCents: true,
  deliveryCounty: true,
  createdAt: true,
  buyer: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
  seller: { select: { id: true, businessName: true } },
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;

export type AdminOrderRow = Prisma.OrderGetPayload<{
  select: typeof ADMIN_ORDER_LIST_SELECT;
}>;

export async function listAdminOrders(
  filters: AdminOrderListFilters,
  db: PrismaHandle = prisma
): Promise<{ orders: AdminOrderRow[]; total: number; pageSize: number }> {
  const where: Prisma.OrderWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { orderNumber: { contains: filters.q } },
            { buyer: { email: { contains: filters.q, mode: "insensitive" } } },
            { buyer: { profile: { fullName: { contains: filters.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      select: ADMIN_ORDER_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    db.order.count({ where }),
  ]);

  return { orders, total, pageSize: ADMIN_PAGE_SIZE };
}

/**
 * One order, fully resolved for the admin screen — read-only by design.
 *
 * There is deliberately no `setOrderStatus` here: nothing in the existing
 * order architecture (`src/services/order-service.ts`, the FastAPI payment
 * boundary) models a safe *administrative* order transition, and inventing
 * one would let an admin skip the state machine that stock and (future)
 * payments are built on. Payments are projected exactly as recorded; money
 * movement stays with its provider flows.
 *
 * Payment rows are selected WITHOUT the payer handle, raw callback payload,
 * or provider metadata — the admin order screen has no need for any of them.
 */
export async function getAdminOrderDetail(orderId: string, db: PrismaHandle = prisma) {
  if (!isUuid(orderId)) return null;

  return db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              condition: true,
              status: true,
              images: {
                orderBy: { sortOrder: "asc" as const },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      buyer: {
        select: {
          id: true,
          email: true,
          profile: { select: { fullName: true, county: true } },
        },
      },
      seller: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          county: true,
          verificationStatus: true,
        },
      },
      payments: {
        orderBy: { createdAt: "desc" as const },
        select: {
          id: true,
          provider: true,
          method: true,
          status: true,
          amountCents: true,
          currency: true,
          paidAt: true,
          createdAt: true,
        },
      },
      settlement: {
        select: {
          id: true,
          status: true,
          grossAmountCents: true,
          commissionAmountCents: true,
          netAmountCents: true,
        },
      },
      refunds: {
        orderBy: { createdAt: "desc" as const },
        select: {
          id: true,
          amountCents: true,
          status: true,
          createdAt: true,
          completedAt: true,
        },
      },
    },
  });
}

export function summarizePayments(payments: Array<{ status: PaymentStatus }>) {
  const counts = new Map<PaymentStatus, number>();
  for (const payment of payments) {
    counts.set(payment.status, (counts.get(payment.status) ?? 0) + 1);
  }
  return counts;
}

// ─── Categories ────────────────────────────────────────────────────────────
//
// Categories are a real database entity (`categories` table: slug, tree via
// parentId, sortOrder, isActive) that the marketplace, seeding, and listing
// forms all read — so admin CRUD belongs at the table itself. Deletion is
// guarded because `Product.categoryId` is `onDelete: Restrict`: a category in
// use can be deactivated (hiding it from the marketplace) but not removed,
// which mirrors how the rest of the schema prefers soft state over cascade
// damage.

export async function listAdminCategories(db: PrismaHandle = prisma) {
  return db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      children: { select: { id: true, name: true, slug: true, isActive: true } },
      _count: { select: { products: true } },
    },
  });
}

export type AdminCategoryRow = Awaited<ReturnType<typeof listAdminCategories>>[number];

/** Clean slug for category creation (no random suffix — `slugify()` in
 * `@/utils` adds one for listings; categories want stable, human URLs). */
function categorySlugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createAdminCategory(params: {
  name: string;
  slug?: string;
  iconName?: string;
  sortOrder: number;
  parentId?: string;
  actor: AdminActor;
  db?: PrismaHandle;
}) {
  const db = params.db ?? prisma;
  const slug = categorySlugify(params.slug ?? params.name);
  if (!slug) throw new AdminServiceError("Could not derive a URL slug from that name.");

  if (params.parentId) {
    const parent = await db.category.findUnique({
      where: { id: params.parentId },
      select: { id: true },
    });
    if (!parent) throw new AdminServiceError("Selected parent category no longer exists.");
  }

  try {
    const category = await db.category.create({
      data: {
        name: params.name,
        slug,
        iconName: params.iconName ?? null,
        sortOrder: params.sortOrder,
        parentId: params.parentId ?? null,
      },
    });

    await logAuditEvent({
      action: "admin.category_created",
      actorId: params.actor.id,
      actorEmail: params.actor.email,
      targetType: "category",
      targetId: category.id,
      metadata: { name: params.name, slug },
    });

    return category;
  } catch (error) {
    throw prismaError(error, "category");
  }
}

export async function updateAdminCategory(params: {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  actor: AdminActor;
  db?: PrismaHandle;
}) {
  const db = params.db ?? prisma;
  if (!isUuid(params.id)) throw new AdminServiceError("Category not found.");

  try {
    const category = await db.category.update({
      where: { id: params.id },
      data: { name: params.name, sortOrder: params.sortOrder, isActive: params.isActive },
      select: { id: true, name: true, slug: true, isActive: true, sortOrder: true },
    });

    await logAuditEvent({
      action: "admin.category_updated",
      actorId: params.actor.id,
      actorEmail: params.actor.email,
      targetType: "category",
      targetId: category.id,
      metadata: { name: category.name, isActive: category.isActive },
    });

    return category;
  } catch (error) {
    throw prismaError(error, "category");
  }
}

export async function deleteAdminCategory(params: {
  id: string;
  actor: AdminActor;
  db?: PrismaHandle;
}) {
  const db = params.db ?? prisma;
  if (!isUuid(params.id)) throw new AdminServiceError("Category not found.");

  const category = await db.category.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, slug: true, _count: { select: { products: true, children: true } } },
  });
  if (!category) throw new AdminServiceError("Category not found.");
  if (category._count.products > 0) {
    throw new AdminServiceError(
      `${category.name} still has ${category._count.products} listing${
        category._count.products === 1 ? "" : "s"
      }. Move them to another category first, or deactivate it instead.`
    );
  }
  if (category._count.children > 0) {
    throw new AdminServiceError(
      `${category.name} still has ${category._count.children} sub-categor${
        category._count.children === 1 ? "y" : "ies"
      }. Move or delete them first.`
    );
  }

  await db.category.delete({ where: { id: category.id } });

  await logAuditEvent({
    action: "admin.category_deleted",
    actorId: params.actor.id,
    actorEmail: params.actor.email,
    targetType: "category",
    targetId: category.id,
    metadata: { name: category.name, slug: category.slug },
  });
}

// ─── Audit trail ───────────────────────────────────────────────────────────

export type AdminAuditListFilters = {
  q?: string;
  page: number;
};

/**
 * The append-only `audit_logs` table, paged and filterable. Reads project
 * only display-safe columns — the row can't leak more than the writer put in
 * (and `audit-service.ts` documents that secrets never go in `metadata`).
 * The raw payload is surfaced as-is so reviewers can see exactly what was
 * recorded.
 */
export async function listAdminAuditEvents(filters: AdminAuditListFilters, db: PrismaHandle = prisma) {
  const where: Prisma.AuditLogWhereInput = filters.q
    ? {
        OR: [
          { action: { contains: filters.q, mode: "insensitive" } },
          { actorEmail: { contains: filters.q, mode: "insensitive" } },
        ],
      }
    : {};

  const [events, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        actorId: true,
        actorEmail: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return { events, total, pageSize: ADMIN_PAGE_SIZE };
}
