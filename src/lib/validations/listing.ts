import { z } from "zod";
import { KENYA_COUNTIES, DEFAULT_CATEGORIES, MAX_LISTING_IMAGES } from "@/lib/constants";
import { SIZE_SYSTEMS, normalizeAvailableSizes } from "@/lib/product-sizes";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { isOwnCloudinaryImageUrl } from "@/lib/validations/upload-security";

const categorySlug = z.enum(
  DEFAULT_CATEGORIES.map((c) => c.slug) as [string, ...string[]]
);

/**
 * Listing images must be IMAGE deliveries from OUR Cloudinary account — the
 * same URL the in-app uploader returned. This closes two gaps a bare
 * `z.string().url()` leaves open:
 *
 *  - another tenant's Cloudinary (or any external) image being stored and
 *    proxied through our `next/image` allowlist, and
 *  - a `/raw/` or `/video/` Cloudinary delivery of arbitrary content uploaded
 *    through the unsigned preset, which would still sit on our own CDN host.
 *
 * Fails closed when the cloud name is unconfigured, like every check in
 * `upload-security.ts`.
 */
export const listingImageSchema = z.object({
  url: z
    .string()
    .url()
    .refine(isOwnCloudinaryImageUrl, {
      message: "Photos must be uploaded with the in-app image uploader",
    }),
  cloudinaryId: z.string().min(1).max(300),
});

export const listingSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(120),
  description: z.string().trim().min(20, "Add a bit more detail (20+ characters)").max(5000),
  categorySlug,
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR"]),
  brand: z.string().trim().max(60).optional().or(z.literal("")),
  size: z.string().trim().max(80).refine((value) => !/[,\x00-\x1f\x7f]/.test(value), "Enter one size without commas or control characters").optional(),
  // An empty select is a valid optional system, not an invalid enum.
  sizeSystem: z.enum(SIZE_SYSTEMS).or(z.literal("")).optional(),
  availableSizes: z.string().trim().max(250).refine((value) => {
    if (!value) return true;
    const parts = value.split(",");
    return parts.length <= 20 && parts.every((part) => {
      const size = part.trim();
      return size.length > 0 && size.length <= 80 && !/[\x00-\x1f\x7f]/.test(size);
    });
  }, "Enter up to 20 non-empty sizes separated by commas").transform(normalizeAvailableSizes).optional(),
  priceCents: z.coerce.number().int().min(100, "Price must be at least KSh 1").max(MAX_MONEY_CENTS),
  isNegotiable: z.boolean().default(false),
  quantity: z.coerce.number().int().min(1).max(9999).default(1),
  county: z.enum(KENYA_COUNTIES, { errorMap: () => ({ message: "Select a county" }) }),
  town: z.string().trim().min(2, "Enter a town or area").max(80),
  contactPreference: z.enum(["CALL", "WHATSAPP", "CHAT", "ANY"]).default("ANY"),
  images: z
    .array(listingImageSchema)
    .min(1, "Add at least one photo")
    .max(MAX_LISTING_IMAGES, `Up to ${MAX_LISTING_IMAGES} photos`),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
}).superRefine((input, ctx) => {
  if (input.sizeSystem && !input.size && !input.availableSizes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sizeSystem"], message: "Add a size or clear the size system" });
  }
});

export type ListingInput = z.infer<typeof listingSchema>;

export const searchParamsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().optional(),
  county: z.string().optional(),
  town: z.string().optional(),
  brand: z.string().optional(),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR"]).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "most_viewed"]).default("newest"),
  cursor: z.string().optional(),
});

export type SearchParamsInput = z.infer<typeof searchParamsSchema>;
