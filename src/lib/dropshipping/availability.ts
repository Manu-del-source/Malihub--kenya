/**
 * Supplier stock freshness — presentation and gating rules, never a guarantee.
 *
 * `SupplierProduct.availableQuantity` is a last-known SNAPSHOT. Even a fresh
 * snapshot is not a reservation: the seller must confirm availability with the
 * supplier before recording a purchase. This module makes staleness explicit
 * so a UI can never present a snapshot as live inventory.
 */

import type {
  SupplierProductStatus,
  SupplierStatus,
  SupplierStockStatus,
} from "@prisma/client";

export type AvailabilityLevel =
  | "AVAILABLE"
  | "LIMITED"
  | "UNKNOWN"
  | "STALE"
  | "UNAVAILABLE";

export type AvailabilitySnapshot = {
  level: AvailabilityLevel;
  label: string;
  /** Always true: supplier stock is never a live reservation. */
  isSnapshot: true;
  /** Always false: only an explicit seller confirmation can proceed to purchase. */
  isGuaranteed: false;
  /** Sellers may import an approved item even when stock is unknown/stale, but
   *  they must see the caveat; unavailable items cannot be imported. */
  canImport: boolean;
  /** The seller must re-confirm stock and cost at the fulfilment step. */
  requiresFulfilmentConfirmation: true;
  isStale: boolean;
  verifiedAt: string | null;
  ageHours: number | null;
  availableQuantity: number | null;
  stockStatus: SupplierStockStatus;
  warnings: string[];
};

export type AvailabilityInput = {
  supplierStatus: SupplierStatus;
  approvalStatus: SupplierProductStatus;
  isActive: boolean;
  stockStatus: SupplierStockStatus;
  availableQuantity: number | null;
  stockVerifiedAt: Date | string | null;
  lastSyncedAt?: Date | string | null;
  maxAgeHours: number;
  now?: Date;
};

const UNAVAILABLE_STOCK: readonly SupplierStockStatus[] = ["OUT_OF_STOCK", "DISCONTINUED"];

/** Pure classification shared by the seller catalog, import route and dashboards. */
export function classifySupplierAvailability(input: AvailabilityInput): AvailabilitySnapshot {
  const now = input.now ?? new Date();
  const verifiedAt = input.stockVerifiedAt ?? input.lastSyncedAt ?? null;
  const verifiedDate = verifiedAt ? new Date(verifiedAt) : null;
  const validDate = verifiedDate && Number.isFinite(verifiedDate.getTime()) ? verifiedDate : null;
  const ageHours = validDate
    ? Math.max(0, (now.getTime() - validDate.getTime()) / 3_600_000)
    : null;
  const maxAgeHours = Number.isFinite(input.maxAgeHours) && input.maxAgeHours > 0
    ? input.maxAgeHours
    : 48;
  const isStale = ageHours === null || ageHours > maxAgeHours;
  const warnings: string[] = [];

  const base = {
    isSnapshot: true as const,
    isGuaranteed: false as const,
    requiresFulfilmentConfirmation: true as const,
    isStale,
    verifiedAt: validDate ? validDate.toISOString() : null,
    ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    availableQuantity: input.availableQuantity,
    stockStatus: input.stockStatus,
  };

  if (input.supplierStatus !== "APPROVED") {
    warnings.push("supplier_not_approved");
    return { ...base, level: "UNAVAILABLE", label: "Supplier not approved", canImport: false, warnings };
  }
  if (input.approvalStatus !== "APPROVED" || !input.isActive) {
    warnings.push("supplier_product_not_approved");
    return { ...base, level: "UNAVAILABLE", label: "Not available for import", canImport: false, warnings };
  }
  if (UNAVAILABLE_STOCK.includes(input.stockStatus) || input.availableQuantity === 0) {
    warnings.push("supplier_out_of_stock");
    return { ...base, level: "UNAVAILABLE", label: "Out of stock", canImport: false, warnings };
  }

  if (validDate === null) {
    warnings.push("stock_never_verified", "snapshot_not_guaranteed");
    return { ...base, level: "UNKNOWN", label: "Stock not verified", canImport: true, warnings };
  }
  if (isStale) {
    warnings.push("stock_snapshot_stale", "snapshot_not_guaranteed");
    return { ...base, level: "STALE", label: "Stock snapshot is stale", canImport: true, warnings };
  }
  if (input.stockStatus === "UNKNOWN") {
    warnings.push("stock_status_unknown", "snapshot_not_guaranteed");
    return { ...base, level: "UNKNOWN", label: "Stock status unknown", canImport: true, warnings };
  }
  if (input.stockStatus === "LOW_STOCK" || (input.availableQuantity !== null && input.availableQuantity <= 5)) {
    warnings.push("limited_stock", "snapshot_not_guaranteed");
    return { ...base, level: "LIMITED", label: "Limited stock (last checked)", canImport: true, warnings };
  }
  warnings.push("snapshot_not_guaranteed");
  return { ...base, level: "AVAILABLE", label: "In stock at last check", canImport: true, warnings };
}
