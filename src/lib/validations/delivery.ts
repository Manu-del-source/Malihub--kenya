import { z } from "zod";
import { MAX_MONEY_CENTS } from "@/lib/money";

const money = z.number().int().min(0).max(MAX_MONEY_CENTS).safe();

export const deliveryEstimateSchema = z.object({
  county: z.string().trim().min(1).max(80),
}).strict();

export const checkoutDeliverySchema = z.object({
  deliveryCounty: z.string().trim().min(1).max(80),
  deliveryAddress: z.string().trim().min(5).max(300).refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s), "Address contains invalid characters."),
  acceptedDeliveryFeeCents: money,
  acceptedSellerCount: z.number().int().min(1).max(9999),
}).strict();

/** Notes are deliberately buyer-visible, not private operational notes. */
export const deliveryQuoteSchema = z.object({
  amountCents: money,
  note: z.string().trim().max(500).refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s), "Note contains invalid characters.").optional(),
}).strict();

export const acceptDeliveryQuoteSchema = z.object({
  quoteVersion: z.number().int().min(1).max(MAX_MONEY_CENTS),
  quotedFeeCents: money,
}).strict();
