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
  PaymentStatus,
  SellerVerificationStatus,
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
  PaymentStatus,
  SellerVerificationStatus,
};

/** Product with its common includes — the shape most listing UIs consume. */
export type ProductWithRelations = Product & {
  images: ProductImage[];
  category: Category;
  seller: Pick<Seller, "id" | "businessName" | "slug" | "logoUrl" | "verificationStatus" | "ratingAverage" | "county">;
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
