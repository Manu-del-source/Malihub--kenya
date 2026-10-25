/**
 * Explicit field allowlists for the three audiences of dropshipping data.
 *
 * The safest way to keep supplier costs, contacts, internal notes and purchase
 * references private is to never SELECT them on a seller or buyer query in the
 * first place. Every new read path should use one of these objects (or a
 * narrower literal) rather than returning a whole Prisma row.
 */

import type { Prisma } from "@prisma/client";

/** Seller catalog: no cost, delivery charge, contact, notes or feed config. */
export const SELLER_SUPPLIER_PRODUCT_SELECT = {
  id: true,
  title: true,
  description: true,
  sku: true,
  sourceUrl: true,
  imageUrl: true,
  currency: true,
  availableQuantity: true,
  isActive: true,
  stockStatus: true,
  stockVerifiedAt: true,
  lastSyncedAt: true,
  approvalStatus: true,
  manualRefreshRequired: true,
  supplier: {
    select: {
      id: true,
      name: true,
      region: true,
      countryCode: true,
      status: true,
      deliveryCounties: true,
      deliveryEstimateMinDays: true,
      deliveryEstimateMaxDays: true,
    },
  },
} satisfies Prisma.SupplierProductSelect;

/** Admin catalog: confidential commercial fields are intentional here. */
export const ADMIN_SUPPLIER_PRODUCT_SELECT = {
  id: true,
  supplierId: true,
  externalProductId: true,
  title: true,
  sku: true,
  description: true,
  sourceUrl: true,
  imageUrl: true,
  costMinor: true,
  currency: true,
  deliveryChargeMinor: true,
  availableQuantity: true,
  isActive: true,
  approvalStatus: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedById: true,
  reviewNote: true,
  stockStatus: true,
  stockVerifiedAt: true,
  verificationMethod: true,
  costStatus: true,
  costVerifiedAt: true,
  deliveryChargeVerifiedAt: true,
  manualRefreshRequired: true,
  feedAdapterKey: true,
  lastVerificationNote: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
  supplier: {
    select: {
      id: true,
      name: true,
      status: true,
      region: true,
      contactEmail: true,
      contactPhone: true,
      paymentResponsibility: true,
      paymentTerms: true,
    },
  },
} satisfies Prisma.SupplierProductSelect;

/** Admin supplier list: contact/business data stays inside the admin boundary. */
export const ADMIN_SUPPLIER_SELECT = {
  id: true,
  name: true,
  slug: true,
  region: true,
  countryCode: true,
  status: true,
  legalName: true,
  registrationNumber: true,
  kraPin: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  physicalAddress: true,
  websiteUrl: true,
  notes: true,
  verificationNotes: true,
  verifiedById: true,
  approvedAt: true,
  submittedAt: true,
  statusChangedAt: true,
  statusReason: true,
  deliveryCounties: true,
  dispatchEstimateMinDays: true,
  dispatchEstimateMaxDays: true,
  deliveryEstimateMinDays: true,
  deliveryEstimateMaxDays: true,
  returnTerms: true,
  paymentTerms: true,
  paymentResponsibility: true,
  commercialTermsVerifiedAt: true,
  commercialTermsNote: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.SupplierSelect;

/** Buyer view: workflow state and courier tracking only. */
export const BUYER_FULFILMENT_SELECT = {
  id: true,
  status: true,
  quantity: true,
  carrierName: true,
  trackingNumber: true,
  trackingUrl: true,
  dispatchedAt: true,
  deliveredAt: true,
  lastStatusChangedAt: true,
  product: { select: { title: true, slug: true } },
} satisfies Prisma.SupplierFulfilmentSelect;

/** Seller view of their own tasks: cost is visible, supplier contact is not. */
export const SELLER_FULFILMENT_SELECT = {
  id: true,
  reference: true,
  orderId: true,
  status: true,
  quantity: true,
  unitRetailCents: true,
  unitCostMinor: true,
  currency: true,
  deliveryChargeMinor: true,
  totalCostMinor: true,
  costStatus: true,
  supplierReference: true,
  purchaseReference: true,
  carrierName: true,
  trackingNumber: true,
  trackingUrl: true,
  dispatchedAt: true,
  deliveredAt: true,
  failureReason: true,
  expectedDispatchAt: true,
  lastStatusChangedAt: true,
  createdAt: true,
  updatedAt: true,
  supplierProduct: { select: { title: true, sku: true, stockStatus: true, stockVerifiedAt: true } },
  supplier: { select: { id: true, name: true, status: true, region: true } },
  order: { select: { id: true, orderNumber: true, status: true, totalCents: true } },
  product: { select: { id: true, title: true, slug: true } },
  purchase: {
    select: {
      id: true,
      status: true,
      amountMinor: true,
      currency: true,
      paymentResponsibility: true,
      paymentTerms: true,
      confirmedAt: true,
      paidAt: true,
      reconciledAt: true,
    },
  },
  returnRequest: { select: { id: true, status: true, reason: true, requestedAt: true } },
} satisfies Prisma.SupplierFulfilmentSelect;

/** Admin operations view: everything needed for exception handling. */
export const ADMIN_FULFILMENT_SELECT = {
  ...SELLER_FULFILMENT_SELECT,
  sellerId: true,
  supplierId: true,
  buyerId: true,
  orderItemId: true,
  deliveryEvidenceNote: true,
  statusReason: true,
  costConfirmedAt: true,
  supplierProduct: {
    select: {
      title: true,
      sku: true,
      costMinor: true,
      currency: true,
      stockStatus: true,
      stockVerifiedAt: true,
    },
  },
} satisfies Prisma.SupplierFulfilmentSelect;
