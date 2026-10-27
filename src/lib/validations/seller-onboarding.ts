import { z } from "zod";
import { KENYA_COUNTIES } from "@/lib/constants";

/**
 * Seller onboarding collects only business-profile information that MaliHub
 * can safely store in its existing Seller model. Government ID images are
 * deliberately excluded until a private, access-controlled document store is
 * configured.
 */
export const sellerApplicationSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your store or business name").max(100),
  description: z.string().trim().min(30, "Tell buyers a little more about your business (at least 30 characters)").max(1200),
  county: z.enum(KENYA_COUNTIES, { error: "Select your county" }),
  subCounty: z.string().trim().max(100).optional().or(z.literal("")),
  kraPin: z
    .string()
    .trim()
    .max(20, "KRA PIN is too long")
    .optional()
    .or(z.literal("")),
});

export type SellerApplicationInput = z.infer<typeof sellerApplicationSchema>;
