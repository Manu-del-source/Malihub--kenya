# MaliHub Kenya

A premium Kenyan marketplace — Next.js 15, Supabase, Prisma, M-Pesa Daraja.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design and
build-phase checklist.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase/Cloudinary/Daraja keys
npx prisma migrate dev       # creates/updates tables from prisma/schema.prisma
```

Then, against your Supabase project's SQL editor (or `supabase db push`),
run these files **in order**:

1. `prisma/migrations/manual_auth_trigger.sql` — mirrors `auth.users` into
   `public.users`/`profiles` on signup. **Required** — nothing else creates
   those rows.
2. `prisma/migrations/manual_rls_policies.sql` — Row Level Security for
   user-owned tables.
3. `prisma/migrations/manual_storage_avatars.sql` — creates the `avatars`
   Storage bucket + policies used by /complete-profile.
4. `prisma/migrations/manual_product_search.sql` — full-text search
   (tsvector + trigram indexes) that `/search` depends on directly.

Also in the Supabase dashboard: **Authentication → Providers → Google**,
enable it and add your OAuth client ID/secret, plus
`{your-app-url}/api/auth/callback` as an authorized redirect URI. "Confirm
email" under Authentication → Settings should stay on (it's the default) —
that's what makes /verify-email meaningful.

In your **Cloudinary** dashboard: Settings → Upload → Upload presets →
add an **unsigned** preset, and put its name in
`NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`. The listing-creation image
uploader (`next-cloudinary`'s widget) uploads directly from the browser
using this preset — no server-side signing involved, so without it
"Add photo" on /dashboard/seller/listings/new silently has nothing to
upload to.

```bash
npm run prisma:seed          # seeds the 16 marketplace categories
npm run dev
```

> **Security note:** this project pins `next@15.5.22`. Do not downgrade to
> `15.1.x` — those versions are vulnerable to CVE-2025-66478, a critical
> (CVSS 10.0) unauthenticated RCE in the App Router's RSC protocol. If you
> ever bump Next.js yourself, check https://nextjs.org/blog/CVE-2025-66478
> and the versions listed there first.

## Project structure

```
src/
  app/            Routes (App Router), grouped by (marketing) / (auth) /
                  (marketplace) / (dashboard), plus api/ route handlers
  components/     ui/, landing/, auth/, marketplace/, dashboard/, shared/
  hooks/          Client-side hooks (useNotifications, useCart, etc.)
  services/       External integrations (auth-service.ts, mpesa.ts, cloudinary.ts)
  lib/            Supabase clients, Prisma client, constants, validations/
  utils/          Pure helper functions (formatKes, slugify, timeAgo, ...)
  types/          Domain types + Supabase generated types
  providers/      React context providers (theme, react-query)
  middleware.ts   Session refresh + route protection
prisma/
  schema.prisma   Full database schema
  migrations/     Prisma migrations + manual full-text-search SQL
```

## Status

Phases 1–5 complete (architecture, scaffolding, landing page, authentication,
marketplace core). See the checklist in `ARCHITECTURE.md` §13 for what's next.

A note on `recharts`/`@faker-js/faker`: npm flags both as past end-of-life
majors. Neither is a security issue (unlike the Next.js CVE above) and
recharts isn't used by anything yet — worth bumping to current majors
before Phase 6 wires up dashboard charts, rather than after.
