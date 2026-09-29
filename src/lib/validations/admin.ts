import { z } from "zod";
import { UserRole, ListingStatus, OrderStatus, SellerVerificationStatus } from "@prisma/client";

/**
 * Server-side input validation for the admin dashboard.
 *
 * Same rule as everywhere else in MaliHub: client validation is UX, the
 * boundary is the schema applied on the server AFTER auth. These schemas back
 * two kinds of input:
 *
 *  - list-page search params — anything arriving via the URL is treated as
 *    hostile: enums reject anything not on Prisma's real enum, page numbers
 *    are coerced and clamped, free text is trimmed and length-capped before it
 *    ever reaches a Prisma `where`;
 *  - mutation payloads (Server Actions) — target ids must be UUIDs, notes are
 *    capped. There is deliberately no field anywhere that carries a role, an
 *    actor id, or a status the service itself computes.
 *
 * The enums are built from `Object.values()` of Prisma's generated runtime
 * enums (not hand-copied string lists) so this file cannot drift from
 * `prisma/schema.prisma`.
 */

function zodEnumFrom<T extends Record<string, string>>(runtimeEnum: T) {
  return z.enum(Object.values(runtimeEnum) as [T[keyof T], ...Array<T[keyof T]>]);
}

export const adminUserRoleSchema = zodEnumFrom(UserRole);
export const adminListingStatusSchema = zodEnumFrom(ListingStatus);
export const adminOrderStatusSchema = zodEnumFrom(OrderStatus);
export const adminSellerVerificationSchema = zodEnumFrom(SellerVerificationStatus);

/** Prisma `@db.Uuid` columns reject anything else; validate before querying. */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const page = z.coerce.number().int().min(1).max(100_000).catch(1);

/** A moderation/review note is optional but bounded; it lands in the audit
 * trail and (for seller decisions) the notification body — never a secret. */
const decisionNote = z
  .string()
  .trim()
  .max(300, "Keep the note under 300 characters")
  .optional()
  .transform((value) => (value ? value : undefined));

export const adminUserListSchema = z.object({
  q: optionalText(120),
  role: adminUserRoleSchema.optional(),
  account: z.enum(["active", "inactive", "banned"]).optional(),
  page,
});
export type AdminUserListInput = z.input<typeof adminUserListSchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListSchema>;

export const adminSellerListSchema = z.object({
  q: optionalText(120),
  verification: adminSellerVerificationSchema.optional(),
  page,
});
export type AdminSellerListQuery = z.infer<typeof adminSellerListSchema>;

export const adminListingListSchema = z.object({
  q: optionalText(120),
  status: adminListingStatusSchema.optional(),
  category: optionalText(80),
  seller: optionalText(120),
  page,
});
export type AdminListingListQuery = z.infer<typeof adminListingListSchema>;

export const adminOrderListSchema = z.object({
  q: optionalText(120),
  status: adminOrderStatusSchema.optional(),
  page,
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListSchema>;

export const adminAuditListSchema = z.object({
  q: optionalText(120),
  page,
});
export type AdminAuditListQuery = z.infer<typeof adminAuditListSchema>;

// ─── Mutation payloads ────────────────────────────────────────────────────

export const sellerReviewActionSchema = z.object({
  sellerId: uuidSchema,
  note: decisionNote,
});
export type SellerReviewActionInput = z.infer<typeof sellerReviewActionSchema>;

export const listingModerationActionSchema = z.object({
  productId: uuidSchema,
  action: z.enum(["approve", "reject", "suspend", "restore"]),
  note: decisionNote,
});
export type ListingModerationActionInput = z.infer<typeof listingModerationActionSchema>;

const categorySlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and hyphens only");

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60),
  slug: categorySlugSchema.optional(),
  iconName: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
  sortOrder: z.coerce.number().int().min(-1000).max(1000).default(0),
  parentId: z.union([uuidSchema, z.literal("")]).optional(),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(2).max(60),
  sortOrder: z.coerce.number().int().min(-1000).max(1000),
  isActive: z.boolean(),
});
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export const categoryDeleteSchema = z.object({ id: uuidSchema });

// ─── Search-param plumbing ────────────────────────────────────────────────

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First value of a Next.js search param (arrays happen with repeated keys). */
export function firstParam(params: RawSearchParams, key: string): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Parses a list page's search params through the page's schema: only the
 * schema's own keys are read (first value each), everything invalid falls back
 * to the schema's defaults, and a schema mismatch returns `null` rather than
 * throwing — a garbage `?role=…` must never become a Prisma error, and must
 * never become raw user input in a query either.
 */
export function parseListParams<S extends z.ZodTypeAny>(
  schema: S,
  searchParams: RawSearchParams
): z.infer<S> | null {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(shape ?? {})) {
    const value = firstParam(searchParams, key);
    if (value !== undefined) data[key] = value;
  }
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}
