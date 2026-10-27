import type {
  User,
  Profile,
  Seller,
  Product,
  ProductImage,
  Category,
  Order,
  OrderItem,
  Payment,
  Review,
  Notification,
  Chat,
  Message,
  UserRole,
  ProductCondition,
  ListingStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  SellerVerificationStatus,
  ReportReason,
  NotificationType,
  AuditLog,
} from "@prisma/client";

export type {
  User,
  Profile,
  Seller,
  Product,
  ProductImage,
  Category,
  Order,
  OrderItem,
  Payment,
  Review,
  Notification,
  Chat,
  Message,
  UserRole,
  ProductCondition,
  ListingStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  SellerVerificationStatus,
  ReportReason,
  NotificationType,
  AuditLog,
};

/** Public catalog shape. This is intentionally not a full Prisma Product. */
export type ProductWithRelations = Pick<
  Product,
  | "id" | "slug" | "title" | "description" | "priceCents" | "isNegotiable"
  | "condition" | "brand" | "quantity" | "contactPreference" | "county"
  | "subCounty" | "status" | "favoriteCount"
> & {
  images: Array<Pick<ProductImage, "url">>;
  category: Pick<Category, "id" | "name" | "slug">;
  seller: Pick<Seller, "businessName" | "slug" | "logoUrl" | "verificationStatus" | "ratingCount" | "county"> & {
    ratingAverage: number;
  };
};

/** Notification fields required by the signed-in viewer's UI. */
export type NotificationView = Pick<Notification, "id" | "type" | "title" | "body" | "linkUrl" | "isRead"> & {
  createdAt: Date | string;
};

/** Standard success/error envelope returned by Route Handlers and Server Actions. */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** Cursor-based pagination response shape used by infinite-scroll listing feeds. */
export type PaginatedResult<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
};

/** Search/filter params shared by the search page, category pages, and API route. */
export type ProductSearchParams = {
  q?: string;
  categorySlug?: string;
  county?: string;
  brand?: string;
  condition?: ProductCondition;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: "newest" | "price_asc" | "price_desc" | "most_viewed";
  cursor?: string;
};
