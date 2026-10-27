ALTER TABLE "orders"
  ADD COLUMN "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_fee_status" TEXT NOT NULL DEFAULT 'ESTIMATED';

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_fee_cents_nonnegative"
  CHECK ("delivery_fee_cents" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_fee_status_valid"
  CHECK ("delivery_fee_status" IN ('ESTIMATED', 'CONFIRMED'));
