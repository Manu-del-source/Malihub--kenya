import { z } from "zod";
import { uuidSchema } from "@/lib/validations/admin";

const campaignSlugSchema = z
  .string()
  .trim()
  .min(2, "Slug must contain at least 2 characters")
  .max(80, "Slug must be at most 80 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

const campaignDate = z.coerce.date();

const campaignWindow = {
  startsAt: campaignDate,
  endsAt: campaignDate,
};

function requireValidWindow<T extends { startsAt: Date; endsAt: Date }>(
  value: T,
  ctx: z.RefinementCtx
) {
  if (value.endsAt.getTime() <= value.startsAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "Campaign end must be later than its start",
    });
  }
}

const campaignProductIds = z
  .array(uuidSchema)
  .max(200, "A campaign can contain at most 200 products")
  .default([])
  .refine((ids) => new Set(ids).size === ids.length, "Products must not be duplicated");

export const campaignCreateSchema = z
  .object({
    title: z.string().trim().min(3, "Title must contain at least 3 characters").max(100),
    slug: campaignSlugSchema,
    description: z.string().trim().max(1000).optional().transform((v) => v || undefined),
    ...campaignWindow,
    productIds: campaignProductIds,
  })
  .superRefine(requireValidWindow);

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = z
  .object({
    id: uuidSchema,
    title: z.string().trim().min(3).max(100),
    slug: campaignSlugSchema,
    description: z.string().trim().max(1000).optional().transform((v) => v || undefined),
    ...campaignWindow,
    productIds: campaignProductIds,
  })
  .superRefine(requireValidWindow);

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

export const campaignStatusActionSchema = z.object({
  id: uuidSchema,
  status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "CANCELLED"]),
});
