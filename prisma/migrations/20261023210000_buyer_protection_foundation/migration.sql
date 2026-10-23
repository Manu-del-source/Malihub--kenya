-- Buyer protection foundations. This migration records shipment and dispute
-- workflow state only; it does not implement escrow or move/hold money.
CREATE TYPE "ShipmentStatus" AS ENUM (
  'NOT_DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNED'
);

CREATE TYPE "ProtectionCaseStatus" AS ENUM (
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_BUYER',
  'RESOLVED_SELLER',
  'CLOSED'
);

CREATE TYPE "ProtectionReason" AS ENUM (
  'ITEM_NOT_RECEIVED',
  'ITEM_NOT_AS_DESCRIBED',
  'DAMAGED_ITEM',
  'WRONG_ITEM',
  'OTHER'
);

ALTER TABLE "orders"
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "inspection_ends_at" TIMESTAMP(3),
  ADD COLUMN "payout_eligible_at" TIMESTAMP(3);

CREATE TABLE "order_shipments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "carrier_name" TEXT NOT NULL,
  "tracking_number" TEXT NOT NULL,
  "tracking_url" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'NOT_DISPATCHED',
  "dispatched_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "last_event_at" TIMESTAMP(3),
  "delivery_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "buyer_protection_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "reason" "ProtectionReason" NOT NULL,
  "status" "ProtectionCaseStatus" NOT NULL DEFAULT 'OPEN',
  "description" TEXT NOT NULL,
  "resolution_note" TEXT,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "buyer_protection_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "buyer_protection_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "submitted_by" UUID NOT NULL,
  "file_url" TEXT NOT NULL,
  "file_type" TEXT NOT NULL,
  "caption" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buyer_protection_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_shipments_order_id_key" ON "order_shipments"("order_id");
CREATE INDEX "order_shipments_status_updated_at_idx" ON "order_shipments"("status", "updated_at");
CREATE UNIQUE INDEX "buyer_protection_cases_order_id_key" ON "buyer_protection_cases"("order_id");
CREATE INDEX "buyer_protection_cases_status_opened_at_idx" ON "buyer_protection_cases"("status", "opened_at");
CREATE INDEX "buyer_protection_cases_buyer_id_opened_at_idx" ON "buyer_protection_cases"("buyer_id", "opened_at");
CREATE INDEX "buyer_protection_evidence_case_id_created_at_idx" ON "buyer_protection_evidence"("case_id", "created_at");

ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buyer_protection_cases" ADD CONSTRAINT "buyer_protection_cases_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buyer_protection_cases" ADD CONSTRAINT "buyer_protection_cases_buyer_id_fkey"
  FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "buyer_protection_evidence" ADD CONSTRAINT "buyer_protection_evidence_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "buyer_protection_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buyer_protection_evidence" ADD CONSTRAINT "buyer_protection_evidence_submitted_by_fkey"
  FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
