-- Run this once via `prisma migrate dev --create-only` (paste this in) or
-- directly against Supabase's SQL editor after the initial `prisma migrate deploy`.
-- Prisma's schema.prisma cannot express tsvector, so full-text search is
-- layered on top of the generated schema here.

alter table "products"
  add column if not exists "search_vector" tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("brand", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) stored;

create index if not exists "products_search_vector_idx"
  on "products" using gin ("search_vector");

-- Trigram index for fuzzy brand/title matching (autocomplete-style search)
create extension if not exists pg_trgm;
create index if not exists "products_title_trgm_idx"
  on "products" using gin ("title" gin_trgm_ops);
