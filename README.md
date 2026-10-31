# MaliHub Kenya

A premium Kenyan marketplace — Next.js 15, Neon Managed Better Auth, Prisma
on independent PostgreSQL, and a FastAPI backend for chat realtime and supporting APIs.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design and
build-phase checklist.

**Two services, one database.** The Next.js app (`src/`) serves the storefront
and dashboards. The FastAPI backend (`backend/`) provides the chat WebSocket service,
health/readiness reporting and supporting backend services. Buyer payments
and Paystack webhooks are handled by the Next.js application. The services
deploy independently and share PostgreSQL and Redis. **Neon Managed Better Auth is authentication** —
credentials, sessions, email verification, password reset and Google OAuth all
live there, and no password is ever stored in this repository's database.
Supabase is retired from the active request path. Legacy Supabase avatar URLs
may remain readable during migration, and rollback-only auth code is retained,
but current image storage is Cloudinary and chat realtime uses FastAPI
WebSockets with Redis. See §2 and §5 of ARCHITECTURE.md, and **`docs/auth/`**
for the authoritative auth design.

## Getting started — Next.js app

```bash
npm install
cp .env.example .env.local   # fill in Neon Auth/Cloudinary/Upstash keys
npx prisma migrate dev       # creates/updates tables from prisma/schema.prisma
```

> **About migrations and the `manual_*.sql` files.** This repository *does* have
> a committed Prisma migration history, in two steps:
> `20260922184914_init_phase9` is the full baseline (every table and enum), and
> `20260925000000_add_auth_user_id_mapping` adds the nullable column mapping a
> Neon Auth identity to `users.id`. `npx prisma migrate deploy` applies them in
> order, so a fresh database is created from scratch and an existing one is
> upgraded without data loss — the auth migration is additive and nullable, and
> touches no existing row.
>
> The `manual_*.sql` files cover what Prisma cannot express — triggers, Row
> Level Security, Supabase Storage buckets, Realtime publication membership, and
> the `tsvector` search column — so **a fresh database needs almost all of them
> too**. The one exception is the Phase 8 file, which exists purely to upgrade an
> *existing* database without destroying data.
>
> Two of them are **legacy**: `manual_storage_avatars.sql` (3) defines the
> Supabase `avatars` bucket that pre-Phase-2 avatars still live in, and
> `manual_phase6_rls_realtime.sql` (5) enables the `supabase_realtime`
> publication that the chat UI used before Phase 3. The application no longer
> writes the bucket or subscribes to that publication, so neither is needed for
> a new deployment — run them only if you are keeping the legacy Supabase
> artefacts they describe (and run (3) before `scripts/migrate-avatars-to-cloudinary.mjs`).
>
> The file names say which phase introduced them, not the order to run them.
> The list below **is** the order to run them.

Then run these files **in order**, each against the database it targets: the
RLS files (2, 5, 7) only where the application database is **hosted on
Supabase Postgres** — they reference Supabase primitives (`auth.uid()`,
`auth.jwt()`, the `supabase_realtime` publication) and cannot be executed as
written against an independent Neon/RDS database, where the application-layer
authorization in `src/lib/auth/session.ts` is the data-layer control. The
storage file (3) runs against your **Supabase project** (legacy avatars live in
that bucket; nothing in the app writes it any more). The rest run against the
application database itself.

1. `prisma/migrations/manual_auth_trigger.sql` — mirrors `auth.users` into
   `public.users`/`profiles` on signup. **Only relevant when the application
   database itself is hosted on Supabase Postgres** (it needs `auth.users`
   in the same database). With an independent application database — Neon,
   RDS, … — skip it: those rows are provisioned by application code
   (`src/services/account-provisioning.ts`) on sign-up, sign-in, and on any
   later request or action by a signed-in identity that is not yet mapped to a
   `users` row.
2. `prisma/migrations/manual_rls_policies.sql` — Row Level Security for
   user-owned tables.
3. `prisma/migrations/manual_storage_avatars.sql` — creates the Supabase
   `avatars` Storage bucket + policies. **Legacy**: no code path uploads there
   since Phase 2 (`/complete-profile` posts to `/api/avatar/upload`, which writes
   to Cloudinary). Needed only while pre-migration avatars are still served from
   that bucket — and by `scripts/migrate-avatars-to-cloudinary.mjs`, which reads
   them from there.
4. `prisma/migrations/manual_product_search.sql` — full-text search
   (tsvector + trigram indexes) that `/search` depends on directly.
5. `prisma/migrations/manual_phase6_rls_realtime.sql` — RLS for
   chats/messages/orders/order_reviews, and enables Supabase Realtime on
   `messages`/`chats`. The Realtime half is **legacy**: chat live updates run on
   the FastAPI WebSocket + Redis fan-out since Phase 3, and nothing subscribes to
   the `supabase_realtime` publication any more, so a new deployment does not
   need those `alter publication …` statements. The RLS half still matters only
   on a Supabase-hosted database (see the paragraph above).
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

Google sign-in is configured in the **Neon Console**, not Supabase: enable
email/password and Google for the branch, then in Google Cloud Console add
`{NEON_AUTH_BASE_URL}/callback/google` as the authorized redirect URI. The auth
service completes the OAuth handshake itself and returns the browser to the
`callbackURL` MaliHub supplied — MaliHub's own `/api/auth/callback` is retired
and answers **410 Gone**. `docs/auth/MIGRATION.md` §5–§6 is the full console
checklist (env vars, trusted domains, email verification).

### Image upload configuration

MaliHub does **not** use a browser-side Cloudinary upload widget or unsigned
upload preset for product, chat or avatar images. The browser sends files to
MaliHub's authenticated Next.js routes; the server validates and sanitizes the
image, then uploads the resulting WebP to Cloudinary.

Configure these variables in the **Next.js/Vercel** environment:

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET` (server-only; never expose it with a
  `NEXT_PUBLIC_` prefix)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CLOUDINARY_UPLOADS_PAUSED=false` (set to `true` for the product/chat
  upload emergency pause)

Product and chat uploads fail closed when Redis or Cloudinary usage protection
cannot be checked. Avatar uploads use the same Cloudinary credentials, but
their current rate limiter fails open when Redis is unavailable and the avatar
route does not yet use the Cloudinary usage threshold/emergency-pause guard.
See [the image-upload security guide](./docs/security/CLOUDINARY_UPLOAD_GUARDRAILS.md)
for exact route limits, rollout checks and this remaining gap.

No `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` is required. Disable old unsigned
presets only after checking that no other application or legacy client still
uses them.

```bash
npm run prisma:seed          # seeds the 17 marketplace categories
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

> **This backend takes no payments.** Buyer payment collection — Paystack
> hosted checkout, the signed `charge.success` webhook, and on-demand
> verification — is implemented in the **Next.js application**
> (`/api/payments/paystack/*`), which owns `PAYSTACK_SECRET_KEY`. This FastAPI
> service holds no payment-provider credentials, registers no collection
> adapters, and mounts no webhook route; `GET /api/v1/payments/providers` is
> the only payment route and it reports that state honestly. The retired PayHero
> integration (Phase 9) has been removed from this repository; historical
> `Payment` rows with `provider='PAYHERO'` are still read through the schema
> for reconciliation. See §7 of ARCHITECTURE.md for the full boundary.

> **Security note:** this project pins `next@15.5.27`. Do not downgrade to
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
  lib/            auth/ (the provider abstraction — the ONLY place
                  @neondatabase/auth is imported), chat/ (WebSocket client +
                  wire protocol), supabase/ (RETAINED ROLLBACK TARGET ONLY —
                  nothing in the request path imports it), Prisma client,
                  constants, redis.ts, rate-limit.ts, csrf.ts, validations/
  utils/          Pure helpers (formatKes, slugify, timeAgo, toKenyanMsisdn, …)
  types/          Domain types + the retained Supabase generated types
  providers/      React context providers (theme, react-query)
  middleware.ts   Authentication gate ONLY (fail-closed, no database access);
                  authorization lives in the server-side guards in lib/auth/
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
    providers/    payments/ (interface + registry; no collection adapters —
                  Paystack lives in the Next.js app), storage/ (Cloudinary-shaped),
                  email/ (Resend)
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
mode there is silent; and `tests/test_payments.py` pins the payment boundary
(no collection adapter is registered on this service; every provider name
answers a 404 with an honest reason — Paystack "lives in the Next.js app",
PayHero "retired" — and no payment or webhook route is mounted).

As of Phase 10 (verified on 2026-10-12; `npm test`, `npx tsc --noEmit`,
`npm run lint`, `npm run build` all run in this environment and recorded in
`.audit/validation-report.json`):

- **`npm test`: 640/640 pass, 0 fail** — including the Paystack payment
  service suites (forged callbacks, invalid signatures, amount/currency
  mismatch, ownership, duplicates, replay, provider-verify failure) and the
  upload-URL validation suite.
- **`npx tsc --noEmit`: clean** (source; `.next/types` is regenerated by the
  build).
- **`npm run lint` (eslint): clean**, no warnings.
- **`npm run build`: exit 0** — full route tree compiles, including
  `/api/payments/paystack/*` and `/checkout/payment-result`.
- **`npm audit`: 10 known advisories remain** (0 critical; 8 high, 2
  moderate) — all in dev-only toolchain or nested build-time dependencies, or
  requiring a major bump (Next 16, Tailwind 4) that this change deliberately
  does not make. `next` itself was patched 15.5.22 → 15.5.27 and the
  sharp/libvips/libheif/librsvg CVEs were closed via a `sharp@0.35.5`
  override inside the range Next itself declares. See ASA-DEPS-001 in
  `.audit/findings.json`.
- **Backend: 467 tests passing, `ruff check` clean** (bandit's `S` rules
  enabled), and `pip-audit -r requirements.lock.txt` reports no known
  vulnerabilities. A pinned lockfile now exists (`backend/requirements.lock.txt`)
  — the repository previously shipped none for the backend.

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
data-preserving migration, the typed `PaymentProvider` interface and provider
registry, storage and email abstractions, token verification on the auth-only
boundary (Supabase-issued when Phase 8 landed, **since re-pointed at Neon
Auth's JWKS**, with the provider's `sub` resolved to `users.id` and the
application role read from Postgres — see `docs/auth/MIGRATION.md` §7),
structured logging with redaction, a single error envelope, health/readiness
endpoints, and production startup validation. The Next.js app was **not**
rewritten — Phase 7's security files and every working feature are untouched,
and the only removals are the Daraja route handlers that the provider-agnostic
design replaces.

**Phase 9 → PayHero (retired, removed).** PayHero was the first provider, but
its integration has since been removed from this repository. No code path
creates a new `PAYHERO` row; the enum value, migrations and historical `Payment`
rows are retained for reconciliation. See `docs/PAYMENTS-PAYHERO.md` for the
retirement record.

**Phase 10 (payments, live) — Paystack is the active provider.** Buyer
collection is implemented in the Next.js app: `POST
/api/payments/paystack/initialize` (hosted checkout), `POST
/api/payments/paystack/webhook` (signed `charge.success` settlement — HMAC-SHA512
over the raw body, verified against `PAYSTACK_SECRET_KEY`), and `GET/POST
/api/payments/paystack/verify` (server-authoritative status the buyer's screens
poll). Settlement is idempotent and concurrency-safe: a payment becomes `PAID`
only after a provider-verified claim passes ownership, exact amount/currency,
and duplicate/replay gates. There is no PayHero fallback.

See the checklist in `ARCHITECTURE.md` §13.
