/**
 * Supplier stock/price adapter boundary.
 *
 * NO supplier API integration is configured or verified in this repository.
 * The only active adapter is `manual`: an authorized administrator records a
 * verification from an out-of-band channel (phone/email/supplier portal). A
 * future adapter must be explicitly implemented and configured with credentials
 * held outside the database; this interface is the extension point, not proof
 * of synchronization.
 */

import type { StockVerificationMethod, SupplierStockStatus } from "@prisma/client";

export type SupplierStockSnapshot = {
  stockStatus: SupplierStockStatus;
  availableQuantity: number | null;
  costMinor: number;
  currency: string;
  deliveryChargeMinor: number | null;
  method: StockVerificationMethod;
  /** Non-secret supplier reference (e.g. an email ticket id), never a token. */
  sourceReference: string | null;
  verifiedAt: Date;
  note: string | null;
};

export type SupplierAdapterContext = {
  supplierProductId: string;
  externalProductId: string | null;
  feedAdapterKey: string | null;
};

export type SupplierCatalogAdapter = {
  readonly key: string;
  readonly isManual: boolean;
  /** Reads a fresh snapshot. Never writes to the database. */
  fetchSnapshot(context: SupplierAdapterContext): Promise<SupplierStockSnapshot>;
};

export class SupplierAdapterUnavailable extends Error {
  readonly code = "supplier_adapter_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "SupplierAdapterUnavailable";
  }
}

/** Default path: a human verification recorded through the admin endpoint. */
export const manualSupplierAdapter: SupplierCatalogAdapter = {
  key: "manual",
  isManual: true,
  async fetchSnapshot() {
    throw new SupplierAdapterUnavailable(
      "No supplier feed is configured. Record the stock and price verification manually.",
    );
  },
};

/**
 * Resolves the configured adapter. Unknown keys fail closed; we never pretend
 * a feed succeeded or fall back to stale data silently.
 */
export function resolveSupplierCatalogAdapter(
  feedAdapterKey: string | null | undefined,
): SupplierCatalogAdapter {
  if (!feedAdapterKey || feedAdapterKey === "manual") return manualSupplierAdapter;
  throw new SupplierAdapterUnavailable(
    `Supplier adapter '${feedAdapterKey}' is not implemented or verified.`,
  );
}
