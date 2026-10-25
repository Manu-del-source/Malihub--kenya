-- Dropshipping supplier catalog foundation.
-- No existing product, order, payment, settlement, or payout rows are modified.
CREATE TYPE "SupplierStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "SupplierRegion" AS ENUM ('KENYA', 'INTERNATIONAL');

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "region" "SupplierRegion" NOT NULL,
  "country_code" VARCHAR(2) NOT NULL DEFAULT 'KE',
  "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING',
  "contact_email" TEXT,
  "contact_phone" TEXT,
  "website_url" TEXT,
  "notes" TEXT,
  "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL,
  "external_product_id" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sku" TEXT,
  "source_url" TEXT,
  "image_url" TEXT,
  "cost_minor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "available_quantity" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "products" ADD COLUMN "supplier_product_id" UUID;

CREATE UNIQUE INDEX "suppliers_slug_key" ON "suppliers"("slug");
CREATE INDEX "suppliers_status_region_idx" ON "suppliers"("status", "region");
CREATE INDEX "suppliers_country_code_status_idx" ON "suppliers"("country_code", "status");
CREATE UNIQUE INDEX "supplier_products_supplier_id_external_product_id_key"
  ON "supplier_products"("supplier_id", "external_product_id");
CREATE INDEX "supplier_products_supplier_id_is_active_idx"
  ON "supplier_products"("supplier_id", "is_active");
CREATE INDEX "supplier_products_is_active_title_idx"
  ON "supplier_products"("is_active", "title");
CREATE INDEX "products_supplier_product_id_idx" ON "products"("supplier_product_id");

ALTER TABLE "supplier_products"
  ADD CONSTRAINT "supplier_products_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products"
  ADD CONSTRAINT "products_supplier_product_id_fkey"
  FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
