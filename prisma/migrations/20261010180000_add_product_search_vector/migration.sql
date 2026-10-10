-- Production-safe database additions required by marketplace search and Paystack.
-- This migration is idempotent so databases where the manual SQL was already
-- applied can still deploy cleanly.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("brand", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "products_search_vector_idx"
  ON "products" USING GIN ("search_vector");

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_title_trgm_idx"
  ON "products" USING GIN ("title" gin_trgm_ops);
