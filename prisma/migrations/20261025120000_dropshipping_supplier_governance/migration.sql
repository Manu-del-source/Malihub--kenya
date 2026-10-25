-- Dropshipping supplier governance, costing, stock freshness, fulfilment,
-- purchase, and return foundation.
--
-- Additive only: no existing order, payment, settlement, payout, or product
-- row is deleted, and no existing price is repriced. Every new money column is
-- integer minor units. No supplier credential is stored here.
--
-- PREFLIGHT: the unique index from 20261025110000 can fail on a database that
-- already holds duplicate active imports. Fail with a count-only message (no
-- seller or supplier identifiers in the error) BEFORE any DDL in this
-- migration, so an operator can remediate duplicates manually instead of
-- leaving a half-applied migration. This is a read-only check.
DO $$
DECLARE
  duplicate_groups INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'supplier_product_id'
  ) THEN
    EXECUTE $query$
      SELECT COUNT(*) FROM (
        SELECT 1 FROM "products"
        WHERE "supplier_product_id" IS NOT NULL AND "status" <> 'REMOVED'
        GROUP BY "seller_id", "supplier_product_id"
        HAVING COUNT(*) > 1
      ) duplicates
    $query$ INTO duplicate_groups;
  END IF;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Dropshipping uniqueness preflight failed: % duplicate seller/supplier-product group(s) exist. Resolve them manually before deploying.',
      duplicate_groups;
  END IF;
END $$;

-- Idempotent repair for environments where the previous migration was rolled
-- back after the preflight above was resolved. The preflight makes this safe
-- on databases with existing imports.
CREATE UNIQUE INDEX IF NOT EXISTS "products_seller_supplier_product_unique"
  ON "products" ("seller_id", "supplier_product_id")
  WHERE "supplier_product_id" IS NOT NULL AND "status" <> 'REMOVED';

-- ─── Enums ─────────────────────────────────────────────────────────────────
CREATE TYPE "SupplierProductStatus" AS ENUM
  ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REMOVED');
CREATE TYPE "SupplierStockStatus" AS ENUM
  ('UNKNOWN', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED');
CREATE TYPE "StockVerificationMethod" AS ENUM
  ('MANUAL', 'SUPPLIER_API', 'SUPPLIER_FEED', 'SUPPLIER_EMAIL');
CREATE TYPE "SupplierPaymentResponsibility" AS ENUM
  ('UNDEFINED', 'SELLER', 'PLATFORM', 'SUPPLIER_CREDIT');
CREATE TYPE "SupplierFulfilmentStatus" AS ENUM
  ('AWAITING_PAYMENT', 'AWAITING_SUPPLIER_CONFIRMATION', 'CONFIRMED', 'ORDERED',
   'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED');
CREATE TYPE "SupplierCostStatus" AS ENUM ('ESTIMATED', 'CONFIRMED', 'FAILED');
CREATE TYPE "SupplierPurchaseStatus" AS ENUM
  ('PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "SupplierReturnStatus" AS ENUM
  ('REQUESTED', 'APPROVED', 'REJECTED', 'ITEM_RETURNED', 'REFUND_PENDING',
   'RESOLVED', 'CANCELLED');
CREATE TYPE "SupplierReturnReason" AS ENUM
  ('DAMAGED', 'INCORRECT', 'COUNTERFEIT', 'UNDELIVERED', 'OTHER');
CREATE TYPE "ReturnResponsibility" AS ENUM
  ('SUPPLIER', 'SELLER', 'COURIER', 'BUYER', 'PLATFORM', 'UNDETERMINED');

-- ─── Supplier business, verification, delivery and commercial terms ────────
ALTER TABLE "suppliers"
  ADD COLUMN "legal_name" TEXT,
  ADD COLUMN "registration_number" TEXT,
  ADD COLUMN "kra_pin" TEXT,
  ADD COLUMN "contact_name" TEXT,
  ADD COLUMN "physical_address" TEXT,
  ADD COLUMN "verification_notes" TEXT,
  ADD COLUMN "verified_by_id" UUID,
  ADD COLUMN "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "status_reason" TEXT,
  ADD COLUMN "delivery_counties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "dispatch_estimate_min_days" INTEGER,
  ADD COLUMN "dispatch_estimate_max_days" INTEGER,
  ADD COLUMN "delivery_estimate_min_days" INTEGER,
  ADD COLUMN "delivery_estimate_max_days" INTEGER,
  ADD COLUMN "return_terms" TEXT,
  ADD COLUMN "payment_terms" TEXT,
  ADD COLUMN "payment_responsibility" "SupplierPaymentResponsibility" NOT NULL DEFAULT 'UNDEFINED',
  ADD COLUMN "commercial_terms_verified_at" TIMESTAMP(3),
  ADD COLUMN "commercial_terms_note" TEXT;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_verified_by_id_fkey"
  FOREIGN KEY ("verified_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Supplier product approval, stock freshness and delivery charge ─────────
ALTER TABLE "supplier_products"
  ADD COLUMN "approval_status" "SupplierProductStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" UUID,
  ADD COLUMN "review_note" TEXT,
  ADD COLUMN "stock_status" "SupplierStockStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "stock_verified_at" TIMESTAMP(3),
  ADD COLUMN "verification_method" "StockVerificationMethod",
  ADD COLUMN "cost_status" "SupplierCostStatus" NOT NULL DEFAULT 'ESTIMATED',
  ADD COLUMN "cost_verified_at" TIMESTAMP(3),
  ADD COLUMN "delivery_charge_minor" INTEGER,
  ADD COLUMN "delivery_charge_verified_at" TIMESTAMP(3),
  ADD COLUMN "manual_refresh_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "feed_adapter_key" TEXT,
  ADD COLUMN "last_verification_note" TEXT,
  ADD COLUMN "removed_at" TIMESTAMP(3);

-- Legacy rows predate the approval workflow. Preserve their seller visibility
-- but mark commercial data as unverified and require a manual refresh; this is
-- NOT a claim that a documented review occurred.
UPDATE "supplier_products"
SET "approval_status" = 'APPROVED',
    "submitted_at" = "created_at",
    "reviewed_at" = "created_at",
    "review_note" = 'Legacy catalog row migrated before product approval; re-verify manually.',
    "stock_status" = 'UNKNOWN',
    "cost_status" = 'ESTIMATED',
    "manual_refresh_required" = true;

ALTER TABLE "supplier_products"
  ADD CONSTRAINT "supplier_products_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "supplier_products_approval_is_active_idx"
  ON "supplier_products"("approval_status", "is_active");
CREATE INDEX "supplier_products_stock_verified_at_idx"
  ON "supplier_products"("stock_verified_at");

-- ─── Stock / price verification history (admin-only) ───────────────────────
CREATE TABLE "supplier_product_verifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_product_id" UUID NOT NULL,
  "stock_status" "SupplierStockStatus" NOT NULL,
  "available_quantity" INTEGER,
  "cost_minor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "delivery_charge_minor" INTEGER,
  "method" "StockVerificationMethod" NOT NULL DEFAULT 'MANUAL',
  "source_reference" TEXT,
  "verified_by_id" UUID,
  "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_product_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_product_verifications_product_time_idx"
  ON "supplier_product_verifications"("supplier_product_id", "verified_at");

-- ─── Per-listing pricing snapshot (seller/admin-only) ──────────────────────
CREATE TABLE "supplier_listing_costs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "supplier_product_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "retail_price_cents" INTEGER NOT NULL,
  "supplier_cost_minor" INTEGER NOT NULL,
  "supplier_delivery_charge_minor" INTEGER NOT NULL DEFAULT 0,
  "seller_fulfilment_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "platform_fee_cents" INTEGER NOT NULL DEFAULT 0,
  "payment_fee_cents" INTEGER NOT NULL DEFAULT 0,
  "tax_cents" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_cents" INTEGER NOT NULL,
  "estimated_profit_cents" INTEGER NOT NULL,
  "margin_bps" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "is_estimate" BOOLEAN NOT NULL DEFAULT true,
  "config_version" TEXT NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_listing_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_listing_costs_product_id_key"
  ON "supplier_listing_costs"("product_id");
CREATE INDEX "supplier_listing_costs_supplier_product_id_idx"
  ON "supplier_listing_costs"("supplier_product_id");
CREATE INDEX "supplier_listing_costs_seller_id_idx"
  ON "supplier_listing_costs"("seller_id");

-- ─── Order item supplier snapshot ──────────────────────────────────────────
ALTER TABLE "order_items"
  ADD COLUMN "supplier_product_id" UUID,
  ADD COLUMN "supplier_product_title" TEXT,
  ADD COLUMN "supplier_sku" TEXT;

-- Preserve the supplier association for historical orders created before this
-- migration. Product rows are not hard-deleted while an order references them.
UPDATE "order_items" AS oi
SET "supplier_product_id" = p."supplier_product_id",
    "supplier_product_title" = sp."title",
    "supplier_sku" = sp."sku"
FROM "products" AS p
LEFT JOIN "supplier_products" AS sp ON sp."id" = p."supplier_product_id"
WHERE p."id" = oi."product_id" AND p."supplier_product_id" IS NOT NULL;

CREATE INDEX "order_items_supplier_product_id_idx"
  ON "order_items"("supplier_product_id");

-- ─── Supplier fulfilment ───────────────────────────────────────────────────
CREATE TABLE "supplier_fulfilments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reference" TEXT NOT NULL,
  "order_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "supplier_product_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "status" "SupplierFulfilmentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "quantity" INTEGER NOT NULL,
  "unit_retail_cents" INTEGER NOT NULL,
  "unit_cost_minor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "delivery_charge_minor" INTEGER NOT NULL DEFAULT 0,
  "total_cost_minor" INTEGER NOT NULL,
  "cost_status" "SupplierCostStatus" NOT NULL DEFAULT 'ESTIMATED',
  "cost_confirmed_at" TIMESTAMP(3),
  "cost_confirmed_by_id" UUID,
  "supplier_reference" TEXT,
  "purchase_reference" TEXT,
  "carrier_name" TEXT,
  "tracking_number" TEXT,
  "tracking_url" TEXT,
  "dispatched_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "delivery_evidence_note" TEXT,
  "failure_reason" TEXT,
  "expected_dispatch_at" TIMESTAMP(3),
  "last_status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_fulfilments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_fulfilments_reference_key"
  ON "supplier_fulfilments"("reference");
CREATE UNIQUE INDEX "supplier_fulfilments_order_item_id_key"
  ON "supplier_fulfilments"("order_item_id");
CREATE INDEX "supplier_fulfilments_order_id_idx"
  ON "supplier_fulfilments"("order_id");
CREATE INDEX "supplier_fulfilments_seller_status_updated_idx"
  ON "supplier_fulfilments"("seller_id", "status", "updated_at");
CREATE INDEX "supplier_fulfilments_supplier_status_idx"
  ON "supplier_fulfilments"("supplier_id", "status");
CREATE INDEX "supplier_fulfilments_status_dispatch_due_idx"
  ON "supplier_fulfilments"("status", "expected_dispatch_at");

CREATE TABLE "supplier_fulfilment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fulfilment_id" UUID NOT NULL,
  "from_status" "SupplierFulfilmentStatus",
  "to_status" "SupplierFulfilmentStatus" NOT NULL,
  "action" TEXT NOT NULL,
  "actor_user_id" UUID,
  "actor_role" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_fulfilment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_fulfilment_events_idempotency_key_key"
  ON "supplier_fulfilment_events"("idempotency_key");
CREATE INDEX "supplier_fulfilment_events_fulfilment_time_idx"
  ON "supplier_fulfilment_events"("fulfilment_id", "created_at");

-- ─── Supplier purchase controls (manual; no provider automation) ───────────
CREATE TABLE "supplier_purchases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fulfilment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "cost_status" "SupplierCostStatus" NOT NULL DEFAULT 'ESTIMATED',
  "payment_responsibility" "SupplierPaymentResponsibility" NOT NULL DEFAULT 'UNDEFINED',
  "payment_terms" TEXT,
  "status" "SupplierPurchaseStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "purchase_reference" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "confirmed_by_id" UUID,
  "confirmed_at" TIMESTAMP(3),
  "paid_by_id" UUID,
  "paid_at" TIMESTAMP(3),
  "payment_reference" TEXT,
  "failure_reason" TEXT,
  "refund_amount_minor" INTEGER NOT NULL DEFAULT 0,
  "reconciled_at" TIMESTAMP(3),
  "reconciled_by_id" UUID,
  "reconciliation_note" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_purchases_fulfilment_id_key"
  ON "supplier_purchases"("fulfilment_id");
CREATE UNIQUE INDEX "supplier_purchases_idempotency_key_key"
  ON "supplier_purchases"("idempotency_key");
CREATE UNIQUE INDEX "supplier_purchases_purchase_reference_key"
  ON "supplier_purchases"("purchase_reference");
CREATE INDEX "supplier_purchases_order_id_idx"
  ON "supplier_purchases"("order_id");
CREATE INDEX "supplier_purchases_status_idx"
  ON "supplier_purchases"("status");

-- ─── Returns / disputes (extends existing buyer protection) ────────────────
CREATE TABLE "supplier_return_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fulfilment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "status" "SupplierReturnStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" "SupplierReturnReason" NOT NULL,
  "reason_note" TEXT,
  "evidence_note" TEXT,
  "responsibility" "ReturnResponsibility" NOT NULL DEFAULT 'UNDETERMINED',
  "return_shipping_party" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "refund_id" UUID,
  "protection_case_id" UUID,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "approved_by_id" UUID,
  "rejected_at" TIMESTAMP(3),
  "returned_at" TIMESTAMP(3),
  "refund_pending_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" UUID,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_return_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_return_requests_fulfilment_id_key"
  ON "supplier_return_requests"("fulfilment_id");
CREATE UNIQUE INDEX "supplier_return_requests_idempotency_key_key"
  ON "supplier_return_requests"("idempotency_key");
CREATE UNIQUE INDEX "supplier_return_requests_refund_id_key"
  ON "supplier_return_requests"("refund_id");
CREATE INDEX "supplier_return_requests_status_requested_idx"
  ON "supplier_return_requests"("status", "requested_at");
CREATE INDEX "supplier_return_requests_order_id_idx"
  ON "supplier_return_requests"("order_id");

-- ─── Foreign keys ──────────────────────────────────────────────────────────
ALTER TABLE "supplier_product_verifications"
  ADD CONSTRAINT "supplier_product_verifications_product_fkey"
  FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_product_verifications_verified_by_fkey"
  FOREIGN KEY ("verified_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_listing_costs"
  ADD CONSTRAINT "supplier_listing_costs_product_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_listing_costs_supplier_product_fkey"
  FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_listing_costs_seller_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_supplier_product_id_fkey"
  FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_fulfilments"
  ADD CONSTRAINT "supplier_fulfilments_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_order_item_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_seller_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_supplier_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_supplier_product_fkey"
  FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_product_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_buyer_fkey"
  FOREIGN KEY ("buyer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilments_cost_confirmed_by_fkey"
  FOREIGN KEY ("cost_confirmed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_fulfilment_events"
  ADD CONSTRAINT "supplier_fulfilment_events_fulfilment_fkey"
  FOREIGN KEY ("fulfilment_id") REFERENCES "supplier_fulfilments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_fulfilment_events_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_purchases"
  ADD CONSTRAINT "supplier_purchases_fulfilment_fkey"
  FOREIGN KEY ("fulfilment_id") REFERENCES "supplier_fulfilments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_purchases_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_purchases_seller_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_purchases_supplier_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_purchases_confirmed_by_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_purchases_paid_by_fkey"
  FOREIGN KEY ("paid_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_purchases_reconciled_by_fkey"
  FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_return_requests"
  ADD CONSTRAINT "supplier_return_requests_fulfilment_fkey"
  FOREIGN KEY ("fulfilment_id") REFERENCES "supplier_fulfilments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_return_requests_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_return_requests_buyer_fkey"
  FOREIGN KEY ("buyer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_return_requests_refund_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "refunds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_return_requests_protection_case_fkey"
  FOREIGN KEY ("protection_case_id") REFERENCES "buyer_protection_cases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_return_requests_approved_by_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_return_requests_resolved_by_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
