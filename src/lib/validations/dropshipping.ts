/**
 * Server-side input contracts for supplier administration and operations.
 * Every mutation route parses with one of these schemas before touching Prisma.
 */

import { z } from "zod";
import { KENYA_COUNTIES } from "@/lib/constants";

export const uuidSchema = z.string().trim().uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalEmail = z.string().trim().email().max(254).optional().or(z.literal(""));
const optionalUrl = z.string().trim().url().max(2048).optional().or(z.literal(""));
const days = z.number().int().min(0).max(365).nullable().optional();
const money = z.number().int().min(0).max(2_000_000_000);

export const supplierCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    region: z.enum(["KENYA", "INTERNATIONAL"]),
    countryCode: z.string().trim().length(2).transform((v) => v.toUpperCase()),
    legalName: optionalText(200),
    registrationNumber: optionalText(120),
    kraPin: optionalText(64),
    contactName: optionalText(120),
    contactEmail: optionalEmail,
    contactPhone: optionalText(40),
    physicalAddress: optionalText(500),
    websiteUrl: optionalUrl,
    notes: optionalText(2000),
    verificationNotes: optionalText(2000),
    deliveryCounties: z.array(z.enum(KENYA_COUNTIES)).max(47).optional().default([]),
    dispatchEstimateMinDays: days,
    dispatchEstimateMaxDays: days,
    deliveryEstimateMinDays: days,
    deliveryEstimateMaxDays: days,
    returnTerms: optionalText(2000),
    paymentTerms: optionalText(2000),
    paymentResponsibility: z
      .enum(["UNDEFINED", "SELLER", "PLATFORM", "SUPPLIER_CREDIT"])
      .default("UNDEFINED"),
    commercialTermsNote: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    const pairs: Array<[string, number | null | undefined, number | null | undefined]> = [
      ["dispatch", value.dispatchEstimateMinDays, value.dispatchEstimateMaxDays],
      ["delivery", value.deliveryEstimateMinDays, value.deliveryEstimateMaxDays],
    ];
    for (const [label, min, max] of pairs) {
      if (min !== null && max !== null && min !== undefined && max !== undefined && min > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} minimum cannot exceed maximum.` });
      }
    }
  });

export const supplierStatusSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().min(4).max(1000),
});

export const supplierProductCreateSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: optionalText(5000),
  sku: optionalText(120),
  externalProductId: optionalText(200),
  sourceUrl: optionalUrl,
  imageUrl: optionalUrl,
  costMinor: money,
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  deliveryChargeMinor: money.nullable().optional(),
  availableQuantity: z.number().int().min(0).max(10_000_000).nullable().optional(),
  submitForReview: z.boolean().default(true),
});

export const supplierProductDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "SUSPEND", "REMOVE", "RESUBMIT"]),
  note: z.string().trim().min(4).max(1000),
});

export const stockVerificationSchema = z.object({
  stockStatus: z.enum(["UNKNOWN", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "DISCONTINUED"]),
  availableQuantity: z.number().int().min(0).max(10_000_000).nullable(),
  costMinor: money,
  deliveryChargeMinor: money.nullable(),
  method: z.enum(["MANUAL", "SUPPLIER_API", "SUPPLIER_FEED", "SUPPLIER_EMAIL"]).default("MANUAL"),
  sourceReference: optionalText(200),
  note: z.string().trim().min(4).max(1000),
});

export const pricingPreviewSchema = z.object({
  categorySlug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  priceCents: z.number().int().min(100).max(2_000_000_000),
  sellerFulfilmentCostCents: money.default(0),
});

export const importSchema = z.object({
  categorySlug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  priceCents: z.number().int().min(100).max(2_000_000_000),
  county: z.enum(KENYA_COUNTIES),
  town: z.string().trim().min(2).max(80),
  quantity: z.number().int().min(1).max(9999).default(1),
  sellerFulfilmentCostCents: money.optional().default(0),
});

export const fulfilmentUpdateSchema = z.object({
  action: z.enum([
    "CONFIRM_AVAILABILITY",
    "RECORD_PURCHASE",
    "RECORD_DISPATCH",
    "RECORD_IN_TRANSIT",
    "RECORD_DELIVERY",
    "REPORT_FAILURE",
    "CANCEL",
    "RETRY",
  ]),
  finalUnitCostMinor: money.optional(),
  supplierReference: optionalText(200),
  purchaseReference: optionalText(200),
  carrierName: optionalText(120),
  trackingNumber: optionalText(120),
  trackingUrl: optionalUrl,
  deliveryEvidenceNote: optionalText(2000),
  reason: optionalText(1000),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export const purchaseConfirmationSchema = z.object({
  action: z.enum(["CONFIRM", "FAIL", "RECONCILE"]),
  paymentReference: optionalText(200),
  purchaseReference: optionalText(200),
  reason: optionalText(1000),
  refundAmountMinor: money.optional(),
  reconciliationNote: optionalText(2000),
});

export const returnRequestSchema = z.object({
  fulfilmentId: uuidSchema,
  reason: z.enum(["DAMAGED", "INCORRECT", "COUNTERFEIT", "UNDELIVERED", "OTHER"]),
  reasonNote: z.string().trim().min(8).max(2000),
  evidenceNote: optionalText(2000),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export const returnDecisionSchema = z.object({
  status: z.enum([
    "APPROVED",
    "REJECTED",
    "ITEM_RETURNED",
    "REFUND_PENDING",
    "RESOLVED",
    "CANCELLED",
  ]),
  responsibility: z
    .enum(["SUPPLIER", "SELLER", "COURIER", "BUYER", "PLATFORM", "UNDETERMINED"])
    .optional(),
  returnShippingParty: optionalText(120),
  resolutionNote: optionalText(2000),
  refundStatus: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
});
