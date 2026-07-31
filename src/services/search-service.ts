import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SearchParamsInput } from "@/lib/validations/listing";
import type { ProductWithRelations, PaginatedResult } from "@/types";

const SORT_COLUMNS = {
  newest: { column: "created_at", direction: "DESC" as const },
  price_asc: { column: "price_cents", direction: "ASC" as const },
  price_desc: { column: "price_cents", direction: "DESC" as const },
  most_viewed: { column: "view_count", direction: "DESC" as const },
};

type Cursor = { value: string; id: string };

function encodeCursor(value: string | number, id: string): string {
  return Buffer.from(JSON.stringify({ value: String(value), id })).toString("base64url");
}

function decodeCursor(cursor: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    if (typeof parsed.value === "string" && typeof parsed.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

const PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: "asc" as const } },
  category: true,
  seller: {
    select: {
      id: true,
      businessName: true,
      slug: true,
      logoUrl: true,
      verificationStatus: true,
      ratingAverage: true,
      county: true,
    },
  },
};

/**
 * Two-step search: (1) a raw SQL query does full-text matching, filtering,
 * sorting, and seek-based pagination against the tsvector column Prisma
 * can't model natively, returning just ordered IDs; (2) a normal typed
 * Prisma query hydrates those IDs with the full relation shape the UI
 * needs. Keeps the tsvector/cursor complexity contained to one function
 * while everything downstream stays fully typed.
 */
export async function searchListings(
  params: SearchParamsInput,
  pageSize = 24
): Promise<PaginatedResult<ProductWithRelations>> {
  const sortConfig = SORT_COLUMNS[params.sort];
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;

  const conditions: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`];

  if (params.q?.trim()) {
    conditions.push(
      Prisma.sql`p.search_vector @@ websearch_to_tsquery('english', ${params.q.trim()})`
    );
  }
  if (params.category) {
    conditions.push(Prisma.sql`c.slug = ${params.category}`);
  }
  if (params.county) {
    conditions.push(Prisma.sql`p.county = ${params.county}`);
  }
  if (params.town) {
    conditions.push(Prisma.sql`p.sub_county ILIKE ${`%${params.town}%`}`);
  }
  if (params.brand) {
    conditions.push(Prisma.sql`p.brand ILIKE ${`%${params.brand}%`}`);
  }
  if (params.condition) {
    conditions.push(Prisma.sql`p.condition = ${params.condition}`);
  }
  if (params.minPrice !== undefined) {
    conditions.push(Prisma.sql`p.price_cents >= ${params.minPrice}`);
  }
  if (params.maxPrice !== undefined) {
    conditions.push(Prisma.sql`p.price_cents <= ${params.maxPrice}`);
  }

  const sortColumnSql = Prisma.raw(`p.${sortConfig.column}`);
  const idColumnSql = Prisma.raw("p.id");

  if (cursor) {
    const op = sortConfig.direction === "DESC" ? Prisma.raw("<") : Prisma.raw(">");
    const cursorValueSql =
      sortConfig.column === "price_cents" || sortConfig.column === "view_count"
        ? Prisma.sql`${Number(cursor.value)}`
        : Prisma.sql`${cursor.value}::timestamp`;
    conditions.push(
      Prisma.sql`(${sortColumnSql}, ${idColumnSql}) ${op} (${cursorValueSql}, ${cursor.id}::uuid)`
    );
  }

  const whereSql = Prisma.join(conditions, " AND ");
  const orderDirection = Prisma.raw(sortConfig.direction);

  const rows = await prisma.$queryRaw<{ id: string; sort_value: string }[]>`
    SELECT p.id, ${sortColumnSql}::text AS sort_value
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE ${whereSql}
    ORDER BY ${sortColumnSql} ${orderDirection}, p.id ASC
    LIMIT ${pageSize + 1}
  `;

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const ids = pageRows.map((r: { id: string; sort_value: string }) => r.id);

  if (ids.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: PRODUCT_INCLUDE,
  });

  const byId = new Map<string, (typeof products)[number]>(
    products.map((p: { id: string }) => [p.id, p as (typeof products)[number]])
  );
  const items = ids
    .map((id: string) => byId.get(id))
    .filter((p: (typeof products)[number] | undefined): p is (typeof products)[number] => !!p);

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.sort_value, last.id) : null;

  return { items, nextCursor, hasMore };
}

export async function getListingBySlug(slug: string) {
  return prisma.product.findUnique({
    where: { slug },
    include: PRODUCT_INCLUDE,
  });
}

export async function getSimilarListings(productId: string, categoryId: string, county: string) {
  return prisma.product.findMany({
    where: {
      id: { not: productId },
      status: "ACTIVE",
      OR: [{ categoryId }, { county }],
    },
    include: PRODUCT_INCLUDE,
    orderBy: { publishedAt: "desc" },
    take: 8,
  });
}

/** Trigram-powered type-ahead over titles (uses the pg_trgm index from
 * manual_product_search.sql) — prefix/fuzzy matching is what a
 * search-as-you-type box needs, not full-text ranking. */
export async function getSearchSuggestions(query: string, limit = 6) {
  if (!query.trim() || query.trim().length < 2) return [];

  const rows = await prisma.$queryRaw<{ title: string; slug: string }[]>`
    SELECT title, slug
    FROM products
    WHERE status = 'ACTIVE' AND title % ${query.trim()}
    ORDER BY similarity(title, ${query.trim()}) DESC
    LIMIT ${limit}
  `;
  return rows;
}

/** "Trending" for the search page's empty-query state: real product
 * titles ranked by view count, not curated copy — see landing-data.ts for
 * why the marketing page still uses editorial content instead. */
export async function getTrendingSearchTerms(limit = 6) {
  const rows = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { viewCount: "desc" },
    take: limit,
    select: { title: true },
  });
  return rows.map((r: { title: string }) => r.title);
}
