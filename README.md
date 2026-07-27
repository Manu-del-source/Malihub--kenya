# MaliHub Kenya

A premium Kenyan marketplace — Next.js 15, Supabase, Prisma, M-Pesa Daraja.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design and
build-phase checklist.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase/Cloudinary/Daraja keys
npx prisma migrate dev       # creates tables from prisma/schema.prisma
# then run prisma/migrations/manual_product_search.sql once against
# your Supabase Postgres instance (adds full-text search)
npm run prisma:seed          # seeds categories + counties
npm run dev
```

## Project structure

```
src/
  app/            Routes (App Router), grouped by (marketing) / (auth) /
                  (marketplace) / (dashboard), plus api/ route handlers
  components/     ui/, landing/, auth/, marketplace/, dashboard/, shared/
  hooks/          Client-side hooks (useNotifications, useCart, etc.)
  services/       External integrations (mpesa.ts, cloudinary.ts, email.ts)
  lib/            Supabase clients, Prisma client, constants
  utils/          Pure helper functions (formatKes, slugify, timeAgo, ...)
  types/          Domain types + Supabase generated types
  providers/      React context providers (theme, react-query)
  middleware.ts   Session refresh + route protection
prisma/
  schema.prisma   Full database schema
  migrations/     Prisma migrations + manual full-text-search SQL
```

## Status

Phases 1–2 complete (architecture + scaffolding). See the checklist in
`ARCHITECTURE.md` §13 for what's next.
