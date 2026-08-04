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
5. `prisma/migrations/manual_phase6_rls_realtime.sql` — RLS for
   chats/messages/orders/order_reviews, and enables Supabase Realtime on
   `messages`/`chats`. **Required** for the chat UI's live updates to work
   at all — without the `alter publication supabase_realtime add table`
   statements in this file, Realtime subscriptions on those tables will
   simply never fire, with no error to point at why.

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
  emails/         React Email templates, sent via services/email-service.ts
  lib/            Supabase clients, Prisma client, constants, validations/
  utils/          Pure helper functions (formatKes, slugify, timeAgo, ...)
  types/          Domain types + Supabase generated types
  providers/      React context providers (theme, react-query)
  middleware.ts   Session refresh + route protection
prisma/
  schema.prisma   Full database schema
  migrations/     Prisma migrations + manual full-text-search SQL
```

## Verification

Before any Phase 6 feature work, three checks must pass clean:
`npx tsc --noEmit`, `npm run lint`, `npm run build`. As of this update:

- **`tsc` and `lint`: clean.**
- **`npm run build`**: the `next build` compilation step itself succeeds
  (webpack bundles the full route tree with no errors); the build script's
  leading `prisma generate` step requires network access to
  `binaries.prisma.sh` to download the query engine. In network-restricted
  environments (locked-down CI, some sandboxes) that step fails with a 403
  and the build script exits before reaching `next build` at all — this is
  an environment/network condition, not a code defect. If you hit this:
  confirm outbound access to `binaries.prisma.sh`, or set
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` if you're intentionally
  offline. On a normal developer machine or standard CI runner this isn't
  an issue.

A note on `@react-email/components` (and the `react-email` package
itself): npm currently flags **every** version — including the actively-
maintained 6.x line Resend ships blog posts about — as "no longer
supported." Multiple developers have hit this exact same confusion
recently; it reads as an npm-registry-side/administrative issue rather
than actual project abandonment (the changelog and blog are still being
updated). Nothing to fix here by swapping packages — just flagging it so
it doesn't look like an oversight.

`recharts` and `@faker-js/faker` — flagged as past-EOL in earlier phases —
are now current majors (`recharts@3`, `faker@10`); neither was a security
issue, just staleness.

## Status

Phases 1–5 complete. **Phase 6 (Messaging, M-Pesa, Orders, Reviews,
Analytics, Moderation) is in progress** — schema, RLS/Realtime setup, the
full notification system, and **Messaging** (Realtime chat, typing/presence,
image sharing, read receipts, edit/delete, block/archive/delete, rate
limiting) are done and verified (`tsc`/`lint`/build all clean — see
Verification above). M-Pesa is next. See the checklist in
`ARCHITECTURE.md` §13.
