import { z } from "zod";
import { CampaignStatus } from "@prisma/client";
import { uuidSchema } from "@/lib/validations/admin";

const slugSchema = z
  .string()
  .trim()
  .min(2, "Use at least two characters for the slug.")
  .max(100, "Keep the slug under 100 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.");

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.");

export const campaignProductIdsSchema = z
  .array(uuidSchema)
  .max(200, "A campaign can include at most 200 products.")
  .transform((ids) => [...new Set(ids)]);

const editableStatus = z.enum([
  CampaignStatus.DRAFT,
  CampaignStatus.SCHEDULED,
  CampaignStatus.ACTIVE,
  CampaignStatus.CANCELLED,
]);

export const campaignFormSchema = z
  .object({
    title: z.string().trim().min(3, "Use at least 3 characters for the title.").max(120),
    slug: slugSchema,
    description: z.string().trim().max(2000).optional().transform((value) => value || undefined),
    startDate: dateSchema,
    endDate: dateSchema,
    status: editableStatus,
    productIds: campaignProductIdsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date." });
    }
    if (value.productIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["productIds"], message: "Choose at least one eligible product." });
    }
  });

export const campaignUpdateFormSchema = campaignFormSchema.extend({ id: uuidSchema });

export type CampaignFormInput = z.infer<typeof campaignFormSchema>;
export type CampaignUpdateFormInput = z.infer<typeof campaignUpdateFormSchema>;

/** Campaign dates are calendar dates in Kenya (UTC+03:00), not server-local dates. */
export function campaignDateRange(startDate: string, endDate: string) {
  return {
    startsAt: new Date(`${startDate}T00:00:00.000+03:00`),
    endsAt: new Date(`${endDate}T23:59:59.999+03:00`),
  };
}

/** Convert stored timestamps to Kenya calendar dates for date inputs. */
export function campaignDateInputValue(date: Date): string {
  const kenya = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const year = kenya.getUTCFullYear();
  const month = String(kenya.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kenya.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
