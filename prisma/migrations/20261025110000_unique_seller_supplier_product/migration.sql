-- Ensure sellers cannot concurrently import duplicate drafts of the same supplier product
-- while preserving the ability to re-import if a listing was REMOVED.
CREATE UNIQUE INDEX IF NOT EXISTS "products_seller_supplier_product_unique"
  ON "products" ("seller_id", "supplier_product_id")
  WHERE "supplier_product_id" IS NOT NULL AND "status" != 'REMOVED';
