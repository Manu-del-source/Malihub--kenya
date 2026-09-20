# MaliHub Kenya

A premium Kenyan marketplace — Next.js 15, Supabase Auth, Prisma on
independent PostgreSQL, and a FastAPI backend for payments.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design and
build-phase checklist.

**Two services, one database.** The Next.js app (`src/`) serves the storefront
and dashboards. The FastAPI backend (`backend/`, added in Phase 8) owns
payments, provider webhooks and health reporting. They deploy independently and
share PostgreSQL and Redis. Supabase is **authentication** — it is not the
application database, and no new file storage is built on it (the one Phase 4
exception is profile avatars; marketplace images are Cloudinary). See §2 of
ARCHITECTURE.md.

## Getting started — Next.js app

```bash
npm install
cp .env.example .env.local   # fill in Supabase/Cloudinary keys
npx prisma migrate dev       # creates/updates tables from prisma/schema.prisma
```

> **About the `manual_*.sql` files.** This repository has no committed Prisma
> migration history, so a database's shape comes from `prisma migrate dev` /
> `prisma db push` against `prisma/schema.prisma`. The manual files cover what
> Prisma cannot express — triggers, Row Level Security, Supabase Storage
> buckets, Realtime publication membership, and the `tsvector` search column —
> so **a fresh database needs almost all of them too**. The one exception is
> the Phase 8 file, which exists purely to upgrade an *existing* database
> without destroying data.
>
> The file names say which phase introduced them, not the order to run them.
> The list below **is** the order to run them.

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
6. `prisma/migrations/manual_phase8_provider_agnostic_payments.sql` —
   **existing databases only; skip on a fresh one**, where
   `prisma migrate dev` already produces this exact shape. It creates
   `audit_logs` (which Phase 7's audit service and step 7 below both expect)
   and generalizes `payments` off the M-Pesa-specific columns onto
   provider-neutral ones, *preserving existing rows*: `mpesaCheckoutRequestId`
   → `providerTransactionId`, `mpesaReceiptNumber` → `providerReference`,
   `mpesaPhoneNumber` → `payerReference`, `resultCode` → `failureCode`,
   `resultDesc` → `failureReason`, `mpesaMerchantRequestId` →
   `metadata.merchantRequestId`. Nothing is dropped before it is copied, and
   every existing payment is backfilled with a `provider` value. This is the
   file that cannot be left to `db push`: renaming a Postgres enum value and
   moving data between columns are both things `db push` would do
   destructively.
7. `prisma/migrations/manual_phase7_security.sql` — RLS on `audit_logs`
   (admin-only reads, no direct write policy — every write goes through
   `services/audit-service.ts`). Run after step 6, which is what creates the
   table; on a fresh database the table comes from Prisma instead, and this
   file still applies.

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

## Getting started — FastAPI backend

The backend is a separate Python service with its own environment file. It is
**not** configured from `.env.local`.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'                 # or: npm run backend:install
cp .env.example .env                    # every value is a safe placeholder
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Requires Python 3.11+. Then:

- Health: <http://localhost:8000/api/v1/health>
- Readiness (database + Redis probes): <http://localhost:8000/api/v1/health/ready>
- Payment providers: <http://localhost:8000/api/v1/payments/providers>
- Swagger UI: <http://localhost:8000/docs> — disabled automatically when
  `ENVIRONMENT=production`

Equivalent npm scripts, run from the repository root (they assume the backend
venv is active or its packages are on your `PATH`):

```bash
npm run backend:dev      # uvicorn --reload on 0.0.0.0:8000
npm run backend:test     # pytest
npm run backend:lint     # ruff check
npm run backend:format   # ruff format
```

> **Phase 8 ships architecture, not a working payment integration.**
> `PAYHERO_ENABLED` defaults to `false`, every `PAYHERO_*` credential in
> `.env.example` is empty, and `PayHeroProvider` is a typed stub that returns
> **HTTP 501** for every operation. There is no STK Push, no Daraja call, no
> webhook route and no payment-mutating endpoint — `GET
> /api/v1/payments/providers` is the only payment route, and it exposes no
> credentials. Real PayHero integration (sandbox credentials, STK Push, a
> signature-verifying webhook, persistence) is **Phase 9**. See §7c of
> ARCHITECTURE.md for the full boundary.

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
  services/       Domain services (auth, chat, listing, notification, email,
                  search, audit) — the choke points other code calls through
  emails/         React Email templates, sent via services/email-service.ts
  lib/            Supabase clients, Prisma client, constants, redis.ts,
                  rate-limit.ts, csrf.ts, validations/
  utils/          Pure helpers (formatKes, slugify, timeAgo, toKenyanMsisdn, …)
  types/          Domain types + Supabase generated types
  providers/      React context providers (theme, react-query)
  middleware.ts   Session refresh + route protection
prisma/
  schema.prisma   Full database schema — the single source of truth for DDL
  migrations/     Manual SQL for changes that must not be applied
                  destructively (see the numbered list above)
backend/
  app/
    main.py       App factory, lifespan, middleware order
    api/v1/       Versioned routers and endpoints (health, payments)
    core/         config, errors, logging, middleware, security, db, redis
    models/       SQLAlchemy mirror of the payments domain — maps tables,
                  never creates them; Prisma still owns every DDL change
    schemas/      Pydantic request/response models
    services/     payment, email, rate-limit, health
    providers/    payments/ (interface + PayHero stub + registry),
                  storage/ (Cloudinary-shaped), email/ (Resend)
  tests/          the suite — no network, no database, no credentials needed
  pyproject.toml  Dependencies plus pytest and ruff configuration
  .env.example    Every variable, commented; all values are safe placeholders
```

## Verification

**Next.js** — three checks must pass clean before feature work:
`npx tsc --noEmit`, `npm run lint`, `npm run build`.

**Backend** — two checks, both runnable with no database, no network and no
credentials:

```bash
cd backend && pytest          # 362 tests as of Phase 8
cd backend && ruff check .    # lint (S/bandit security rules are enabled)
```

The backend suite is worth more than its count suggests: `tests/test_models.py`
parses `prisma/schema.prisma` and compares it against the SQLAlchemy mirror, so
a schema change the backend was not told about fails the suite instead of
writing to a column that does not exist; `tests/test_logging.py` asserts on
secrets that must *not* appear rather than fields that must, because the failure
mode there is silent; and `tests/test_payments.py` pins the Phase 8 boundary
(the PayHero stub returns 501, makes no network call, and reports itself
unavailable even when configured).

As of Phase 8:

- **`npm run lint` (eslint): clean**, no warnings.
- **`npx tsc --noEmit`: cannot be evaluated in a network-restricted sandbox**,
  and the reason is worth being precise about. All 53 errors it reports are
  `Module '"@prisma/client"' has no exported member …` (model and enum type
  re-exports in `src/types/index.ts`) plus `Property 'sql'/'raw'/'join' does
  not exist on type 'typeof Prisma'` in `src/services/search-service.ts`.
  Every one is a consequence of the generated client being absent —
  `node_modules/.prisma/client` contains only its placeholder stubs — and none
  is in a file Phase 8 touched. `prisma generate` and `prisma validate` both
  fail in this sandbox with a TLS error reaching `binaries.prisma.sh`, so the
  client cannot be produced here. On a machine with normal outbound access,
  run `npm run prisma:generate` first and `tsc --noEmit` is expected clean;
  that is the gate to trust, not the sandbox result.
- **`npm run build`**: the `next build` compilation step itself succeeds
  (webpack bundles the full route tree with no errors); the build script's
  leading `prisma generate` step requires network access to
  `binaries.prisma.sh` to download the query engine. In network-restricted
  environments (locked-down CI, some sandboxes) that step fails and the build
  script exits before reaching `next build` at all — an environment/network
  condition, not a code defect. If you hit this: confirm outbound access to
  `binaries.prisma.sh`, or set `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` if
  you are intentionally offline.
- **Backend: 362 tests passing, `ruff check` clean** (with bandit's `S` rules
  enabled) and `ruff format --check` clean. None of it needs a database, a
  network connection or a credential.
- **`prisma/schema.prisma`**: since the Prisma CLI cannot run here, the schema
  was validated structurally instead — brace balance across all 41 blocks,
  every field line in all 23 models and 16 enums parses, no duplicate model or
  `@@map` names, every `@relation` targets a model that exists, and the
  `Payment` model contains no surviving `mpesa*`/`resultCode`/`resultDesc`
  field. `backend/tests/test_models.py` goes further and compares the mirror
  against the parsed schema on every run.

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

**Phases 1–5 complete.** Phase 6 (Messaging, Payments, Orders, Reviews,
Analytics, Moderation) is **partially** complete: the schema, RLS/Realtime
setup, the full notification system and **Messaging** (Realtime chat,
typing/presence, image sharing, read receipts, edit/delete, block/archive,
conversation search, rate limiting) are done and verified. Orders, reviews,
analytics and moderation are not built — their dashboard directories are still
placeholders.

**Phase 7 (security hardening) complete** — CSRF protection, rate limiting, a
shared Redis client, upload content validation, the audit service, and
theme-init hardening.

**Phase 8 (production architecture) complete** — the independent FastAPI
backend in `backend/`, the provider-agnostic `Payment` model and its
data-preserving migration, the typed `PaymentProvider` interface with a PayHero
stub and provider registry, storage and email abstractions, Supabase token
verification on the auth-only boundary, structured logging with redaction, a
single error envelope, health/readiness endpoints, and production startup
validation. The Next.js app was **not** rewritten — Phase 7's security files and
every working feature are untouched, and the only removals are the Daraja route
handlers that the provider-agnostic design replaces.

**Phase 9 (next): PayHero integration** — real API calls, STK Push, a
signature-verifying webhook endpoint, idempotent callback processing,
persistence, and the order/notification side effects described in §7d of
ARCHITECTURE.md.

See the checklist in `ARCHITECTURE.md` §13.
