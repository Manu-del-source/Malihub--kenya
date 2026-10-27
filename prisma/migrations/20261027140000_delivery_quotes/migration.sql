ALTER TABLE "orders"
  ADD COLUMN "delivery_quote_cents" INTEGER,
  ADD COLUMN "delivery_quote_note" TEXT,
  ADD COLUMN "delivery_quote_updated_at" TIMESTAMPTZ;

ALTER TABLE "orders"
  DROP CONSTRAINT IF EXISTS "orders_delivery_fee_status_valid";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_fee_status_valid"
  CHECK ("delivery_fee_status" IN ('ESTIMATED', 'QUOTED', 'CONFIRMED'));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_quote_cents_nonnegative"
  CHECK ("delivery_quote_cents" IS NULL OR "delivery_quote_cents" >= 0);
