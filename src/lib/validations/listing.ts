import { z } from "zod";
import { KENYA_COUNTIES, DEFAULT_CATEGORIES, MAX_LISTING_IMAGES } from "@/lib/constants";

const categorySlug = z.enum(
  DEFAULT_CATEGORIES.map((c) => c.slug) as [string, ...string[]]
);

export const listingImageSchema = z.object({
  url: z.string().url(),
  cloudinaryId: z.string().min(1),
});

export const listingSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(120),
  description: z.string().trim().min(20, "Add a bit more detail (20+ characters)").max(5000),
  categorySlug,
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR"]),
  brand: z.string().trim().max(60).optional().or(z.literal("")),
  priceCents: z.coerce.number().int().min(100, "Price must be at least KSh 1"),
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
