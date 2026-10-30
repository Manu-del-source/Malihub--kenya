# MaliHub Kenya — System Architecture

Phase 1 of the build plan. This document is the source of truth for how the
pieces fit together; every later phase implements against it.

## 1. Goals & non-goals

**Goals:** a premium, fast, accessible Kenyan marketplace (Apple/Airbnb/Stripe
register, not Jiji's), with real mobile-money payments behind a
provider-agnostic interface (Paystack live, PayHero retired, direct Daraja
reserved), three
distinct dashboards (seller/buyer/admin), and a data model that scales past
the MVP.

**Non-goals for v1:** multi-currency, multi-country, native mobile apps,
real-time video, and a bespoke chat platform. Messaging is DB-backed, with
Postgres as the source of truth and a light push layer on top: the FastAPI
WebSocket fans out Redis notifications (Phase 3), and a lost socket degrades to
plain HTTP with no data loss. (The Supabase Realtime subscription this replaced,
and the unused `socket.io-client` that sat in the dependency list as a "later
upgrade path", are both gone — Phase 4 of `docs/SUPABASE-REMOVAL-PLAN.md`.)

## 2. High-level system diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Next.js 15 (App Router)                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐    │
│  │ Server         │  │ Client         │  │ Route Handlers        │    │
│  │ Components     │  │ Components     │  │ /api/*                │    │
│  │ (data reads,   │  │ (forms, cart,  │  │ (mutations, webhooks) │    │
│  │  RSC-first)    │  │  motion, chat) │  │                       │    │
│  └───────┬───────┘  └───────┬───────┘  └───────────┬───────────┘    │
│          │                  │                       │                │
│          └────────────┬─────┴───────────┬───────────┘                │
└───────────────────────┼─────────────────┼────────────────────────────┘
                        │                 │
                        │      ┌──────────▼────────────────────────────┐
                        │      │  FastAPI backend (Phase 8)  /api/v1    │
                        │      │  payments, webhooks, health, and the   │
                        │      │  provider adapters that need a long-   │
                        │      │  lived process and signed callbacks    │
                        │      └───┬──────────────┬───────────────┬────┘
                        │          │              │               │
             ┌──────────▼──────┐   │   ┌──────────▼─────────┐     │
             │  Prisma Client   │   │   │  SQLAlchemy mirror │     │
             │  (app data:      │   │   │  (payments domain; │     │
             │  products, orders│   │   │   maps, never      │     │
             │  payments, …)    │   │   │   creates)         │     │
             └──────────┬───────┘   │   └──────────┬─────────┘     │
                        └───────┬───┴──────────────┘               │
                                │                                  │
             ┌──────────────────▼───────────────────┐   ┌──────────▼─────────┐
             │  PostgreSQL — application database    │   │  Redis (Upstash)   │
             │  `public.*`, owned by Prisma          │   │  cache, rate-limit │
             │  migrations. Any managed provider.    │   │  and temp state    │
             └───────────────────────────────────────┘   │  only — never a    │
                                                         │  primary store     │
             ┌───────────────────────┐                   └────────────────────┘
             │  Neon Auth (Managed   │
             │  Better Auth)         │
             │  identity ONLY:       │
             │  credentials, sessions│
             │  OAuth, JWT issuance  │
             └───────────────────────┘

             ┌───────────────────────────────────┐
             │  Supabase — RETIRED as a runtime  │
             │  dependency (Phase 4). Serves     │
             │  pre-migration avatar URLs only;  │
             │  the auth rollback set is inert.  │
             └───────────────────────────────────┘

             ┌───────────────────┐   ┌────────────────────────┐
             │  Cloudinary       │   │  Payment providers     │
             │  (image storage + │   │  Paystack (active)     │
             │   transforms)     │   │  PayHero (retired)     │
             └───────────────────┘   │  Daraja (reserved)     │
                                     └────────────────────────┘
```

**Supabase is no longer in the request path at all.** Neon Managed Better Auth
issues and verifies user sessions (§5, and `docs/auth/ARCHITECTURE.md`); Storage
moved to Cloudinary (Phase 2) and chat Realtime to the FastAPI WebSocket over
Redis (Phase 3), and Phase 4 deleted the remaining Supabase client code, the
Supabase SDK dependency and the Supabase origins from the CSP. There is still no
second auth system and no second password store anywhere in this repository.
What survives is deliberately inert — see
`docs/SUPABASE-REMOVAL-PHASE4-REPORT.md` for the itemized list. Concretely:

- **Supabase is not the application database.** Application data lives in an
  independent PostgreSQL instance, reached through Prisma from Next.js and
  through a read/write mirror from FastAPI. Hosting that Postgres *on* Supabase
  remains possible, but nothing in the code depends on it: no Supabase-specific
  database feature is used, so any standard managed PostgreSQL 13+ (Neon, RDS,
  …) works unchanged. See §6c.
- **Supabase is not the file store for anything, old or new.** Marketplace images
  and profile **avatars** both go to Cloudinary — avatars since Phase 2, via an
  authenticated server-side upload (`POST /api/avatar/upload`) that never exposes
  a credential to the browser. The backend's `StorageProvider` abstraction (§14)
  is Cloudinary-shaped for the same reason. The `*.supabase.co` entries that
  remain in `next.config.ts` exist only so avatars uploaded *before* the cutover
  keep rendering; they come out once
  `scripts/migrate-avatars-to-cloudinary.mjs` has run and production verification
  shows no row still pointing at Supabase (Phase 4 report → "still to do").
- **Neon Auth tokens are consumed, never issued, by the backend** (§5) — and
  because the JWT `sub` is the *provider's* id, the backend must resolve
  `users.auth_user_id → users.id` before it queries anything. It does this in
  `backend/app/core/identity.py`; see `docs/auth/MIGRATION.md` §7.

**Two processes, one schema.** Next.js and FastAPI deploy independently and
talk to the same Postgres and the same Redis. Prisma owns every DDL change;
the SQLAlchemy layer only maps tables that already exist and must never emit
schema. See §6c and §14.

## 3. Rendering strategy

- **Server Components by default.** Product listing pages, category pages,
  and the landing page fetch data directly in RSCs via Prisma — no client-side
  fetch waterfall, no loading spinners for primary content.
- **Client Components only where interaction requires it:** search-as-you-type,
  cart, wishlist toggles, image galleries with gestures, dashboard charts,
  chat, forms (React Hook Form needs the client).
- **ISR** on the landing page, category pages, and product detail pages
  (`revalidate: 60–3600s` depending on volatility) so pages are cached at the
  edge but never more than an hour stale.
- **Route Handlers (`/api/*`)** are reserved for: things Server Actions can't
  do (webhooks needing raw request signatures, the M-Pesa callback endpoint,
  which Safaricom calls directly), and public JSON endpoints consumed by
  client-side infinite scroll / React Query.
- **Server Actions** handle same-origin mutations (create listing, update
  order status, admin moderation actions) — colocated with the forms that
  call them, validated with the same Zod schema on client and server.

## 4. Route architecture (App Router route groups)

```
(marketing)   → public landing, static/marketing pages — no auth required
(auth)        → login, register, forgot/reset password, verify-email
(marketplace) → products, categories, search — public, SEO-critical, RSC-heavy
(dashboard)   → seller/, buyer/, admin/ — all behind middleware auth+role gate
```

Route groups let each area have its own `layout.tsx` (marketing gets a public
nav + footer; dashboards get a sidebar shell) without affecting the URL path.

## 5. Auth architecture

> **Provider: Neon Managed Better Auth.** Supabase Auth is no longer the
> identity provider, and since Phase 4 nothing else in Supabase is a runtime
> dependency either — the retained files under `src/lib/supabase/` are the
> documented rollback target and are imported by nothing. The full design is in **`docs/auth/ARCHITECTURE.md`**
> and the cutover/rollback plan in **`docs/auth/MIGRATION.md`**. This section is
> the summary; those documents are authoritative for auth.

- **Neon Auth owns credentials**, email verification, password reset, and
  Google OAuth. Passwords never exist in MaliHub's database.
- **Two ids, mapped deliberately.** The provider's user id is *not* the
  application's. `users.id` stays a MaliHub-generated UUID (every foreign key in
  the schema targets it), and the provider id is stored in the separate UNIQUE
  column `users.auth_user_id`. Tying the primary key to an external system would
  make the next provider change a destructive migration; this way it is a
  backfill.
- **Application code provisions the rows** (`src/services/account-provisioning.ts`,
  idempotent, called on sign-up, sign-in and authoritatively inside the
  /complete-profile transaction). The auth service authenticating a person does
  not, by itself, create rows in MaliHub's Postgres (§6c).
- **No `app_metadata`, and no claim cache of any kind.** The previous design
  mirrored `role` / `onboarded` / `has_seller_profile` into the provider's JWT so
  middleware could read them at the edge. Neon Auth exposes no equivalent (it
  accepts no custom Better Auth plugins and no arbitrary claims) — and that turns
  out to be an improvement, because a claim cache is a second copy of the truth
  that can lag. A stale `onboarded` claim caused a dashboard ↔ /complete-profile
  redirect loop that this repository had to fix twice.
- **Authorization boundary = MaliHub's own Postgres rows**, read at the point of
  use by the guards in `src/lib/auth/session.ts` (`requireUser`,
  `requireOnboardedUser`, `requireSellerAccess`, `requireAdministrator`). Role is
  never read from a token. Where the application database is hosted on
  **Supabase Postgres**, RLS is the backstop for anything that reaches Postgres
  another way (direct anon/authenticated-role access). Where it runs on an
  **independent PostgreSQL database — Neon, the current deployment** — that
  backstop does not apply: the repository's RLS DDL
  (`prisma/migrations/manual_rls_policies.sql`, `manual_phase6_rls_realtime.sql`,
  `manual_phase7_security.sql`) is keyed on Supabase primitives (`auth.uid()`,
  `auth.jwt()`, the `supabase_realtime` publication) and cannot be executed
  against an independent Postgres as written, and the independent database has
  no anon-key access path to begin with. The application-layer checks above are
  therefore the data-layer control on Neon — they are the primary design
  regardless of host (§6c), and cross-user access is refused and tested there.
- **Middleware answers exactly one question: is there a valid session?**
  `src/middleware.ts` makes no database call and holds no authorization opinion.
  It fails *closed* — an unconfigured or unreachable auth service redirects
  protected routes to `/login` rather than serving them. Public routes are never
  handed to the auth service at all, so an anonymous visitor browsing the
  marketplace costs no session validation.
- **The abstraction layer is `src/lib/auth/`.** `src/lib/auth/neon.ts` is the
  *only* module in the application that imports `@neondatabase/auth`. Pages,
  layouts, Server Actions and Route Handlers import the barrel (`@/lib/auth`) and
  never mention the provider — which is what makes a rollback a two-file change
  rather than a sweep across forty call sites.
- **The FastAPI backend consumes provider tokens; it never issues them.** Its
  `TokenVerifier` (`backend/app/core/security.py`) verifies Neon Auth JWTs
  against the JWKS published at
  `{NEON_AUTH_BASE_URL}/.well-known/jwks.json`, with `iss` expected to be the
  service *origin* — the base URL with its path dropped. The two derivations
  differ by exactly the part that is easy to transpose, so both are derived from
  `NEON_AUTH_BASE_URL` in `backend/app/core/config.py` rather than configured by
  hand, and `backend/tests/test_neon_auth.py` pins the difference.
- **The backend makes the same authentication/authorization split.** The JWT `sub`
  is the provider's id, so `backend/app/core/identity.py` resolves
  `users.auth_user_id → users.id` and reads role, onboarding and seller status
  from Postgres. There is no `app_metadata` claim to read, and the token's own
  `role` claim (`"authenticated"`) is ignored for authorization — a test asserts
  that a token claiming `"role": "SUPER_ADMIN"` does not produce a staff context.
  `SupabaseJwtVerifier` is retained behind `AUTH_PROVIDER=supabase-legacy`, with
  no cross-provider fallback: a backend that accepted both would honour a stale
  Supabase token after the cutover. See `docs/auth/MIGRATION.md` §7.

## 5a. Auth implementation notes

- **Customer registration is buyer-first; seller access is separately approved.**
  Every new account completes `/complete-profile` as a buyer. The server-side
  validation rejects attempts to submit a seller or combined account intent;
  the public homepage, navigation, footer and customer onboarding do not recruit
  sellers. An authenticated customer can apply from Account, which creates an
  unverified seller profile but does not promote the user's role. The applicant
  submits business details at `/seller/onboarding`, moving verification to
  `PENDING` for the existing admin review queue. Admin verification changes
  the seller status to `VERIFIED` and grants the `SELLER` role; rejection or
  resetting verification removes that role from non-staff accounts. Seller
  dashboard access is gated on having a Seller row, so applicants can track
  their application, but only `VERIFIED` sellers may create, publish, or
  republish listings. Public listing queries also require a verified seller.
  Identity-document uploads remain disabled until private document storage is
  configured.
- **Onboarding is enforced server-side, not in middleware.** Any authenticated
  user whose `profiles.onboarded` is not true is sent to `/complete-profile` by
  `requireOnboardedUser()`. Middleware deliberately does not check this: it would
  need a database round trip on every request, and reading it from a token is
  exactly the stale-claim failure mode described in §5.
- **Password reset is token-based, not session-based.** The emailed link lands on
  `/reset-password?token=…` and `resetPasswordAction` consumes the token
  directly. There is no "recovery session", so the page and action must work
  while signed out. Links expire after 15 minutes.
- **Email verification has two paths.** Verification LINKS are primary but
  require a custom email provider configured in the Neon Console; verification
  CODES work with the shared provider available immediately.
  `resendVerificationAction` asks for a link and falls back to a code when the
  service reports links are not enabled, and `/verify-email` adapts to whichever
  was actually sent.
- **Google OAuth does not round-trip through MaliHub.** The auth service owns the
  handshake at `{NEON_AUTH_BASE_URL}/callback/google` and returns the browser to
  the `callbackURL` MaliHub supplied. `/api/auth/callback` is retired (410 Gone).
- **Session-reading routes must declare `export const dynamic =
  "force-dynamic"`.** Reading a Neon Auth session does not necessarily touch a
  cookie (an unconfigured environment short-circuits first), so without the
  declaration a build run without the auth variables would prerender protected
  pages as static redirects to `/login`.
- **Avatar photos are Cloudinary now, not Supabase Storage** (Phase 2): the
  uploader posts to the server-only `POST /api/avatar/upload`, so no anon key
  reaches the browser. Legacy Supabase avatar URLs stay *readable and valid*
  until the production migration is verified — that is the one thing keeping
  `NEXT_PUBLIC_SUPABASE_URL` in the environment (see the Phase 4 report).
- **Manual SQL migrations**: `manual_rls_policies.sql` still applies where the
  application database is Supabase Postgres;
  `manual_storage_avatars.sql` describes the legacy `avatars` bucket pre-Phase-2
  avatars still live in and is unrelated to auth. The auth
  migration itself adds one Prisma migration
  (`20260925000000_add_auth_user_id_mapping`), which is additive and nullable —
  it locks nothing and breaks no existing row.

## 6. Database design

Full schema: `prisma/schema.prisma`. Key decisions:

- **Money as integer cents** (`priceCents`, `amountCents`, etc.) — avoids
  float-rounding bugs in a payments-heavy app. `formatKes()`/`kesToCents()`
  in `src/utils` are the only places that convert to/from major units.
- **Soft listing states** (`DRAFT → PENDING_REVIEW → ACTIVE → SOLD /
  SUSPENDED / REMOVED`) instead of hard deletes, so order history and
  reviews never orphan.
- **Full-text search** via a generated `tsvector` column + GIN index, added
  through a raw SQL migration (`prisma/migrations/manual_product_search.sql`)
  since Prisma has no native `tsvector` type — title/brand/description are
  weighted A/B/C so title matches rank highest.
- **County/sub-county as plain strings**, validated client-side against
  `KENYA_COUNTIES` — avoids a rigid FK to a locations table while Kenya's
  47-county list is effectively static.
- Indexes are placed on every foreign key used in a hot-path filter
  (`category+status`, `county+status`, `seller`) since listing browse/filter
  is the highest-read path in the app.

## 6a. Marketplace implementation notes (Phase 5)

- **"Town" in the UI is `Product.subCounty` in the schema.** No column
  rename — Kenya's admin hierarchy (county → sub-county → ward) already
  maps close enough to (county → town) for marketplace purposes, and
  renaming would have touched Phase 1's schema for cosmetic reasons only.
- **Same service layer powers Server Actions and API routes.** Every
  mutation in `services/listing-service.ts` is called from both
  `(dashboard)/seller/listings/actions.ts` (Server Actions, used by the
  actual UI) and the `/api/products/*` routes (REST, for future
  mobile/external consumers) — ownership checks and business logic live
  once, in the service, not duplicated per entry point.
- **`ListingView` (a log table) vs. `Product.viewCount` (a running
  counter)**: every render path that displays view counts reads the fast
  counter; the log table exists only for dedup (`recordListingView` checks
  it before incrementing) and future analytics. Summing the log table
  per-request would be needlessly expensive for a number shown on every
  card.
- **View-count dedup is two-layered**: server-side, a logged-in viewer
  can't inflate a listing's count more than once per 30 minutes
  (`VIEW_DEDUPE_WINDOW_MINUTES` in `listing-service.ts`); anonymous
  viewers are deduped client-side only, via `sessionStorage`
  (`view-tracker.tsx`) — there's no reliable server-side identity to key
  off for anonymous traffic without fingerprinting, which this project
  deliberately doesn't do.
- **Soft states, extended**: `ARCHIVED` was added to `ListingStatus`
  alongside the states from Phase 1 (`DRAFT/PENDING_REVIEW/ACTIVE/SOLD/
  SUSPENDED/REMOVED`). "Delete" in the seller dashboard still means
  `REMOVED`, not a row delete — same reasoning as Phase 1 (order/review
  history must never orphan). Every listing query that shouldn't surface
  removed items filters `status: { not: "REMOVED" }` explicitly rather
  than relying on a default scope, since Prisma has no query-level global
  filters — worth remembering when Phase 6+ adds more listing queries.
- **New listings skip `PENDING_REVIEW`.** The enum value still exists
  (for a future moderation queue), but publishing today goes straight
  `DRAFT → ACTIVE` — there's no moderation UI yet for anything to wait on,
  so gating publish behind a review state nothing processes would just be
  a dead end for sellers.
- **Avatar photos: Cloudinary, server-side** (Phase 2 — `POST /api/avatar/upload`,
  authenticated, magic-byte checked; pre-migration Supabase URLs still render).
  **Listing photos: Cloudinary** (`next-cloudinary`'s unsigned upload widget,
  `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`) — per the original stack choice, now
  actually wired up.

## 6b. Communication & transactions implementation notes (Phase 6, in progress)

- **`OrderReview` is a new model, not a repurposed `Review`.** `Review`
  (Phase 1) rates a *product* and has no transaction attached; the
  brief's "buyer rates seller / seller rates buyer" is fundamentally a
  *person* rating tied to a *completed order*, in either direction.
  Overloading `Review` with nullable person-fields would have made every
  existing query need new null-checks for no benefit — a second model
  with its own `(orderId, authorId, direction)` uniqueness constraint is
  cleaner. `Review` remains in the schema, unused, for a possible future
  product-quality-review feature — it isn't dead code so much as
  not-yet-built scope.
- **`Order.sellerId` is denormalized and required, not derived.** Phase
  6's checkout is single-listing ("Buy Now"), so every order has exactly
  one seller by construction — storing it directly avoids a
  buyer→items→product→seller join on every "my orders as a seller" query.
  A future multi-seller cart would need to split checkout into one Order
  per seller at the point of purchase, not relax this field.
- **`Message.content` and `imageUrl` are both nullable**, with the
  application layer (not a DB constraint) enforcing that at least one is
  present — a text-only message needs no image, an image-only message
  needs no caption, but a message needs to carry *something*.
- **Push delivery is scoped to chat only.** Everything else (notifications,
  favorites, listing stats) uses polling or plain request/response — pushing
  every table would multiply connection overhead for features where a few
  seconds of staleness is genuinely fine. Chat is the one place users perceive
  lag directly, turn by turn, the way they would in any messaging app. The
  mechanism is the FastAPI WebSocket + Redis fan-out (§8a); the tables are
  still read over HTTP, and the deliverable is a notification, not state.
- **RLS now covers `chats`/`messages`/`orders`/`order_items`/`payments`/
  `order_reviews`** (`manual_phase6_rls_realtime.sql`), on top of Phase
  4's user-data policies. Order/payment tables get *read* policies only —
  every write to those tables goes through Prisma Server Actions (checkout,
  the Paystack webhook) on the privileged connection, so there's nothing
  for the anon/authenticated roles to need insert/update access for.
  **Scope caveat:** that file is runnable only against a Supabase-hosted
  application database (it references `auth.uid()` and the
  `supabase_realtime` publication — see its header). On the independent Neon
  deployment it is inapplicable as-is, and chat/order authorization is
  enforced in the application layer (§5). Its Realtime half
  (`alter publication supabase_realtime …`) is legacy since Phase 3 — no client
  subscribes to that publication any more. The `avatars` Storage-bucket
  policies (`manual_storage_avatars.sql`) likewise only describe the legacy
  bucket that pre-Phase-2 avatars are still served from; nothing writes it.

## 6c. Database portability & who owns the DDL (Phase 8)

Two rules, both of which exist because the alternative is a class of bug that
only appears in production.

**The application database is portable PostgreSQL.** Nothing added from Phase
8 onward uses a Supabase-specific database feature. Concretely:

- UUID keys are `gen_random_uuid()`, which is core PostgreSQL 13+ — not the
  `uuid-ossp` extension and not a Supabase helper.
- JSON is `jsonb`, timestamps are `timestamptz`, enums are plain Postgres
  `CREATE TYPE … AS ENUM`. All standard.
- Authorization in the application layer is explicit ownership checks in code,
  not Row Level Security. After Phase 4 there is no Supabase-client read path
  left to back-stop (§5), so the policies are relevant only where the database
  itself is Supabase-hosted — which is what allows the backend to connect with
  an ordinary application role.
- Full-text search uses the standard `tsvector`/GIN pattern already in place
  from Phase 5, not a Supabase extension.

Supabase Postgres remains a perfectly good *host* for this database. The point
is that the choice is a deployment decision, not a dependency: moving to Neon
or RDS is a `DATABASE_URL` change and nothing else.

**Prisma owns the schema; the backend only maps it.** `prisma/schema.prisma`
is the single source of truth for tables, columns, indexes, constraints and
enums, and Prisma migrations are the only thing that changes them. The
SQLAlchemy classes in `backend/app/models/` are a *mirror*:

- They never call `create_all()` and emit no DDL. Two migration histories
  against one database is how a schema ends up in a state neither tool
  describes. `backend/tests/test_models.py` enforces this textually.
- Every Postgres enum is declared `create_type=False`, because Prisma already
  created the type.
- Column names are Prisma's `@map` names, and index/constraint names are the
  ones Prisma generates, so `prisma migrate diff` reports no drift.
- The mirror is deliberately *small* — the payment domain only. Mirroring all
  whole schema up front would create one thing to keep in sync per model, for
  code that does not exist yet. Each model gets mirrored when a backend service
  needs it.

The tests parse `prisma/schema.prisma` and compare it against the mirror, so a
schema change that the backend was not told about fails the suite rather than
writing to a column that does not exist.

## 7. Payments: provider-agnostic architecture

Phase 8 replaced the M-Pesa-Daraja-specific design in this section with a
provider-agnostic one. The reason is not speculative flexibility: M-Pesa is a
*rail*, and processors (Paystack, historically PayHero, someday Daraja) sit on
it — the original schema conflated the two, `PaymentMethod.MPESA` named a
processor where a channel belonged, and every column was prefixed `mpesa`.
Adding a card processor to that schema is a migration and a rewrite; adding one
to this schema is an adapter.

**Current state (Phase 10):** Paystack is the active provider, implemented in
the **Next.js application** (`src/lib/payments/` + `src/services/payment-*.ts`
+ `/api/payments/paystack/*`). The FastAPI backend keeps the provider-agnostic
contract and registry but registers **no** collection adapter and holds no
provider credentials. PayHero — the provider that Phase 9 was about to build —
has been removed from the repository; its enum value and historical rows are
retained (§7a, and `docs/PAYMENTS-PAYHERO.md`).

### 7a. The model

`Payment` records *which processor moved the money*, separately from *which
channel the customer used*:

| Field | Meaning |
| --- | --- |
| `provider` | `PAYSTACK` (active) · `PAYHERO` (retired, historical rows only) · `DARAJA` (reserved) · `MANUAL` — the processor. Default flipped to `PAYSTACK` in `manual_phase10_paystack_provider_default.sql` |
| `method` | `MOBILE_MONEY` · `CARD` · `BANK_TRANSFER` · `CASH_ON_DELIVERY` — the channel |
| `status` | `PENDING → PROCESSING → SUCCESS / FAILED / CANCELLED / REFUNDED` |
| `amountCents` | Integer minor units. Never a float, never a provider-formatted string (§6) |
| `currency` | ISO 4217, default `KES` |
| `providerTransactionId` | The processor's own id (for Paystack, the transaction `id`). Unique — this is the idempotency key a retried callback is matched against |
| `providerReference` | The settlement/receipt reference a customer can quote (for Paystack, the transaction `reference` — what `GET /transaction/verify/{reference}` takes). Unique |
| `customerReference` | *Our* unique `MH-…` reference handed to Paystack at initialization (kept distinct from the order number so a buyer can never steer a charge to another order by choosing the reference). Required — a Payment always comes from a known Order |
| `payerReference` | Provider-reported payer handle, normalized (an MSISDN, a masked PAN). The one piece of payer PII on the row, kept because support and refunds genuinely need it, and never logged (§11) |
| `metadata` | Opaque provider-specific detail as JSON. Not indexed, not queried |
| `failureCode` / `failureReason` | Normalized failure signalling. `failureCode` is a string on purpose: processors disagree on the shape (Daraja reports integers, `1032` cancelled; Paystack reports gateway strings) — a string column holds both without a lossy cast, and the adapter owns the translation |
| `rawCallbackPayload` | The verbatim callback body, kept for dispute resolution and replay. Raw, never re-serialized: the point is being able to re-verify the signature |
| `retryCount` | Attempts against the same Order. A retry creates a **new** Payment row and bumps this counter rather than mutating a failed one, so every attempt stays auditable |

The Phase 7 → 8 rename, applied in
`prisma/migrations/manual_phase8_provider_agnostic_payments.sql`:
`mpesaCheckoutRequestId → providerTransactionId`,
`mpesaReceiptNumber → providerReference`, `mpesaPhoneNumber → payerReference`,
`resultCode → failureCode`, `resultDesc → failureReason`,
`mpesaMerchantRequestId → metadata.merchantRequestId`. Existing rows are
backfilled rather than dropped — `MOBILE_MONEY → DARAJA`,
`CARD/BANK_TRANSFER → PAYHERO`, `COD → MANUAL` — so no payment history is lost.

### 7b. The provider interface

`backend/app/providers/payments/base.py` defines a typed `PaymentProvider`
protocol with four operations:

- `initialize(request)` — start a charge; returns the provider's transaction id.
- `check_status(provider_transaction_id)` — poll the provider.
- `parse_webhook(envelope)` — verify and decode an inbound callback. The
  envelope carries `raw_body: bytes`, because signature verification must run
  over the exact bytes received, not a re-serialized dict.
- `verify_payment(provider_reference)` — confirm a claimed reference resolves
  to the amount and currency we expect.

`check_status` and `verify_payment` are separate operations on purpose. The
first asks "what does the provider say happened?"; the second asks "does what
the provider says match *our order*?" — and only the second is safe to settle
on, because a customer-supplied reference that resolves to someone else's
payment must not mark our order paid.

Providers register in a registry (`registry.py`) keyed by `PaymentProvider`.
Registering a name twice raises at startup rather than silently replacing an
adapter. **Today the registry is deliberately empty in this backend**: `PAYSTACK`
is reserved with the reason "implemented in the Next.js application" (where the
secret key lives), `PAYHERO` is reserved as *retired* (historical rows still
carry it; no code path creates new ones), and `DARAJA`/`MANUAL` are reserved as
before — enum values that exist so adding a provider is a code change rather
than a destructive enum migration, each answering a 404 with an explanation
instead of a 500.

### 7c. What the backend does *not* do — and why

This is a deliberate boundary, and it is enforced by tests rather than by
convention:

- **No payment-provider calls from this service.** Paystack collection —
  hosted checkout initialization, the signed `charge.success` webhook, and
  verification — is implemented in the Next.js application, which owns
  `PAYSTACK_SECRET_KEY`. This service holds no provider credentials, so a
  leaked backend deployment leaks nothing usable against Paystack.
- **No PayHero, anywhere.** The Phase 9 PayHero integration has been removed
  from this repository (client, routes, service, configuration, tests). No
  code path in either application creates a new `PAYHERO` row, and there is no
  PayHero fallback of any kind. Historical rows are read through the schema
  only, for reconciliation.
- **No payment-mutating endpoint and no webhook route.** `GET
  /api/v1/payments/providers` is the only payment route, and it reports the
  state above honestly. A webhook route that cannot verify a signature is worse
  than no webhook route — the verifiable one lives at
  `POST /api/payments/paystack/webhook` in the Next.js app.
- **No production payment credentials**, real or placeholder-shaped. The only
  payment variable this service knows is `PAYMENTS_DEFAULT_PROVIDER=MANUAL`,
  and resolving that name still 404s with the honest reason (offline
  settlement has no processor).
- **No persistence in the service layer.** `PaymentService` orchestrates
  providers and returns typed results; it does not write rows, because there is
  no flow here to write them from. Rows are written by the Next.js payment
  services against the same schema.

### 7d. The flow, as implemented (Phase 10, Next.js app)

1. Buyer confirms order → `Order` (`PENDING`) and `Payment` (`PENDING`,
   `provider = PAYSTACK`, `method = MOBILE_MONEY`) with a unique `MH-…`
   `customerReference`.
2. `POST /api/payments/paystack/initialize` (server action behind auth + CSRF
   + per-buyer rate limit) calls Paystack's `POST /transaction/initialize`
   with the amount in **subunits** (KES cents × 100), the buyer's email,
   `channels: ["mobile_money"]`, and our reference. The provider's
   `reference` and `access_code` are stored on the attempt **immediately** —
   the webhook can arrive before the initiation response does.
3. Paystack's hosted checkout collects the M-Pesa payment. The buyer's browser
   may land on `/checkout/payment-result`; that page is a navigation
   convenience and is **not** a payment signal.
4. Paystack posts `charge.success` to `POST /api/payments/paystack/webhook`.
   The handler verifies `x-paystack-signature` — hex HMAC-SHA512 of the **raw
   request bytes** keyed with `PAYSTACK_SECRET_KEY` (Paystack's documented
   scheme; constant-time compare, no re-serialization) — then resolves the
   reference to *our* payment row, checks exact integer amount and currency,
   stores the redacted payload, and **re-verifies the transaction against
   Paystack's authenticated API** before any claim runs. An unverifiable
   delivery gets a 401 and writes nothing.
5. Settlement is a conditional database claim: `(provider, providerEventId)`
   dedup plus a status guard make a retried or replayed delivery a no-op, and
   a payment already in a terminal state cannot be settled twice or notify
   twice. On success: `Order.status → PAID` through the order-transition
   service (with an ownership check), notifications, and `payment.success`
   audit events.
6. **Pull channel:** `POST /api/payments/paystack/verify` (same-origin,
   per-buyer rate limited) lets a waiting buyer's screen ask the *server* to
   re-verify the attempt with Paystack — the same conditional claims settle it.
   The browser's claim of success has no power on its own; the server decides
   by asking Paystack.
7. **Failed payment recovery:** the buyer retries from the order page; the
   attempt rules (max 5 per order, in-flight joins rather than duplicates)
   decide whether a new attempt or the existing one answers. There is no PayHero
   fallback and no manual "mark paid" for buyer-side claims.
8. **Provider-unreachable failures** (verification endpoint down) never settle
   and never fabricate a status — the attempt stays awaiting confirmation and
   the next webhook retry or verify call settles it once the provider answers.

## 8. Notifications (implemented in Phase 6)

- `notifyUser()` (`services/notification-service.ts`) is the single choke
  point every other service calls through — always creates the
  `Notification` row; conditionally fans out an email via Resend based on
  `type`. A fixed set of types (`PAYMENT_UPDATE`, `ORDER_UPDATE`,
  `LISTING_APPROVED`, `LISTING_REJECTED`) email by default — everything
  else (new favorite, listing sold) stays in-app-only. Deliberately
  conservative: it's easy to add a type to the email set later, harder to
  win back trust from an over-notified inbox.
  - Email failures never propagate to the caller — a broken Resend key
    shouldn't break a favorite/message/order action, just silently skip
    the email (logged server-side).
- In-app notifications are read via a polling hook (`useNotifications`,
  React Query, 45s interval + refetch-on-focus) — matches the original
  plan in this section almost exactly. **Realtime is deliberately reserved
  for chat** (§ messaging notes below), where sub-second latency actually
  changes the experience; a 45s-stale unread badge count is an acceptable
  trade for not running a second Realtime subscription on every page.
- Notification bell lives in both the marketing header and the dashboard
  header (`components/notifications/notification-bell.tsx`) — same
  component, rendered from two different layouts, gated on `isSignedIn`.
- Triggers wired up so far: new favorite on your listing, listing marked
  sold (notifies everyone who favorited it). Order/payment/message/review
  triggers land as those features are built.

## 8a. Messaging implementation notes (Phase 6)

- **One WebSocket connection per tab, many chats.** The Supabase Realtime hook
  (`useChatRealtime`, one channel per chat, combining `postgres_changes` +
  `broadcast` + `presence`) was deleted in Phase 4 and replaced by
  `useChatSocket` (`src/hooks/use-chat-socket.ts`) over
  `src/lib/chat/ws-client.ts`: the client opens one FastAPI connection with a
  one-shot Redis ticket from `POST /api/chat/ws-ticket` and `join`s/`leave`s
  chats on it, so switching conversations never opens a second socket and
  membership is re-authorized server-side on every join against Postgres.
  Message history, sending, editing and read state all remain HTTP + Postgres —
  Redis carries notifications, never messages.
- **Rate limiting is DB-backed, not in-memory or Redis.** An in-memory
  counter doesn't work correctly on serverless (each invocation can hit a
  different instance, so limits reset constantly); Redis is scaffolded
  (`.env.example`'s `UPSTASH_REDIS_REST_URL`) but not required. Counting
  recent `Message` rows by `senderId` (`assertUnderRateLimit` in
  `chat-service.ts`) is correct regardless of deployment topology, at the
  cost of one extra query per send — worth revisiting with Redis only if
  that query becomes a measured bottleneck.
- **XSS defense is architectural, not a sanitization library.** Message
  content is only ever rendered as `{message.content}` — plain text
  through React's default JSX escaping — never `dangerouslySetInnerHTML`,
  never interpreted as markdown/HTML. `stripControlCharacters` in
  `lib/validations/chat.ts` is defense-in-depth against control-character
  abuse, not the actual XSS boundary; there's nothing to sanitize because
  there's no HTML-rendering path to inject into.
- **Presence and "typing" are two different Realtime primitives on
  purpose.** Presence answers "who's currently connected to this
  channel" (join/leave events, `channel.track()`); typing is a
  fire-and-forget broadcast with a client-side 3s expiry
  (`TYPING_TIMEOUT_MS`) — there's no "stopped typing" event to listen
  for, so the receiver just assumes typing has stopped if no new
  broadcast arrives in time. Simpler and more robust than trying to
  catch every path that should clear the indicator (blur, send, close
  tab, network drop).
- **Chat list membership excludes rows the viewer soft-deleted**
  (`buyerDeletedAt`/`sellerDeletedAt`), independent of the other
  participant's state — `getUserChats`'s `WHERE` clause is intentionally
  asymmetric per user, not a shared "deleted" flag. Sending a new message
  into a chat either party had deleted un-deletes it for the *recipient*
  only (see `sendMessage`'s transaction) — reviving a conversation by
  messaging into it again is expected behavior, not a bug to guard
  against.
- **Emoji picker is a small curated grid, not a full unicode emoji
  library.** Deliberate scope call for MVP chat — a dependency like
  emoji-mart is a reasonable upgrade if usage data ever shows people
  wanting more than the ~35 curated options.

## 9. Search & discovery (implemented in Phase 5)

- **Full-text search**: `search-service.ts` builds a raw SQL query against
  the `search_vector` tsvector column (`manual_product_search.sql`) using
  `websearch_to_tsquery` — this is a `WHERE` filter, not a ranking factor.
  Deliberately *not* ranked by `ts_rank`: the brief calls for four explicit
  sort modes (newest/price/most-viewed), so blending in relevance scoring
  would make sort order behave differently whenever `q` is present vs.
  absent — surprising, and not what was asked for. A `relevance` sort mode
  ranked by `ts_rank` would be a reasonable future addition, additive to
  the existing four.
- **Filters** (category, county, town, brand, condition, price range)
  compose as additional `WHERE` clauses, combinable with `q` or standalone.
- **Pagination is seek-based, not offset**, and — unlike the original
  sketch in this section — the cursor generalizes to *whichever* column
  the active sort uses (`created_at`, `price_cents`, or `view_count`), not
  always `created_at`. Cursor = base64 `{value, id}`; the `id` tie-break
  matters because sort values collide often (many listings share a price
  or a view count). Two-step execution: raw SQL resolves the ranked/sorted
  *id list* for the page, then a normal typed `prisma.product.findMany`
  hydrates those ids with the full relation shape — keeps the raw-SQL
  surface area small and everything downstream fully typed.
- **Autocomplete** uses the `pg_trgm` index (also from
  `manual_product_search.sql`) via `similarity()`, not the tsvector column
  — prefix/fuzzy title matching is a different problem than full-text
  ranking, and trigram is what a type-ahead needs.
- **Recent searches** are client-side only (`sessionStorage` in the hero
  search bar), not a database table — they're ephemeral per-browser
  history, a different concept from `SavedSearch` (a deliberate save with
  alerts, still unbuilt as of Phase 5).
- **Trending/"popular" terms** on the actual `/search` page come from real
  data (`getTrendingSearchTerms` — active listings ranked by `viewCount`),
  unlike the landing page's hero, which intentionally keeps curated
  marketing copy (see `landing-data.ts`'s header comment) since a fresh
  deploy has no organic traffic yet to rank by.

## 10. Design system (theme)

Token system is wired now (`tailwind.config.ts` + `globals.css`) as HSL CSS
variables so light/dark swap is a single class toggle with no re-render of
color logic. Starting palette: an ink-indigo dark mode (default) warming to
a copper "horizon" primary accent, with a muted acacia green as the tertiary
accent — grounded in a Rift Valley dusk rather than generic AI-template
palettes. Phase 3 runs the full brainstorm/critique pass (typography pairing,
hero signature element, motion direction) on top of these same tokens, so
nothing built so far gets discarded — only refined.

Glassmorphism is a utility class (`.glass`, `.glass-sm`) layered on the
token system, used for nav bars and cards that float over gradient/hero
sections — not applied blanket-wide, to keep the "premium" read instead of
tipping into visual noise.

## 11. Security

### Next.js application

- Service-role Supabase client (`createServiceRoleClient`) is isolated to
  `src/lib/supabase/server.ts` and, since Phase 4, is imported by nothing in the
  request path at all — only by the unreferenced auth rollback module
  (`src/lib/supabase/auth-legacy.ts`). Its service-role key stays out of every
  client bundle by construction: no Client Component can reach it, and the
  backend env template forbids the same key server-side.
- Every Server Action re-validates input with the same Zod schema used on the
  client — client validation is UX, server validation is the actual boundary.
- Uploads are validated by content, not by declared type:
  `src/lib/validations/upload-security.ts` checks magic bytes and the
  Cloudinary hostname *and cloud name*, because `res.cloudinary.com` is shared
  by every Cloudinary customer and a hostname allowlist alone would accept a
  link into someone else's bucket.
- CSRF protection (`src/lib/csrf.ts`), rate limiting (`src/lib/rate-limit.ts`)
  and the shared Redis client (`src/lib/redis.ts`) are the Phase 7 controls and
  remain in force. The audit trail is `src/services/audit-service.ts`.

### FastAPI backend

- **Errors never leak internals.** One envelope for every failure —
  `{"error": {"code", "message", "details", "request_id"}}` — with a `code`
  that is stable enough to branch on and a `message` safe to show a user. An
  unhandled exception returns a generic 500 whose `details` contain only the
  exception *type*, and in production not even that. Stack traces go to the log
  with the request id, never to the response.
- **Logging is redacted at the handler.** `RedactionFilter`
  (`backend/app/core/logging.py`) removes anything under a secret-bearing key
  (`api_key`, `password`, `authorization`, `signature`, `webhook_secret`, …),
  partially masks identifying-but-useful fields (`email`, `ip_address`,
  `user_agent`) so two users remain distinguishable without either being
  identifiable, and scrubs credentials interpolated into free-form message text
  — DSNs, `Bearer …`, `key=value` pairs, JWTs and known key prefixes
  (`sk_live_`, `re_`, `AKIA`, …). Booleans and counters *about* a secret
  (`has_credentials=True`) are preserved: redacting those destroys precisely
  the diagnostic that tells you a deployment is misconfigured.
  `payerReference` and `rawCallbackPayload` are never logged — payment PII
  stays on the row.
- **CORS is an explicit allowlist.** `allow_origins = ["*"]` is rejected at
  startup in production, and so is an empty or unset origin list — the wildcard
  with credentials is the misconfiguration that turns any site into an
  authenticated client. Origins come from `CORS_ALLOWED_ORIGINS`.
- **Tokens arrive only in the `Authorization` header**, never in a cookie or a
  query string (§5). A `service_role` JWT is refused with 403.
- **Interactive API docs are off in production.** `/docs` and `/openapi.json`
  describe every route and schema; serving that publicly is reconnaissance
  handed to an attacker. `ENABLE_DOCS=false` is enforced, not merely default.
- **Rate limiting** reuses the Phase 7 Redis and the same bucket arithmetic as
  `src/lib/rate-limit.ts`, under a distinct key namespace
  (`malihub:api:ratelimit:v1:…`) so the two services cannot consume each
  other's budget. It **fails open** by default: a Redis outage should degrade
  throttling, not take the API down — and it logs a warning every time it does,
  because silently-unlimited is the failure mode you would otherwise not see.
- **Webhook verification runs over raw bytes** and a failed verification
  returns 401 with the code only. The endpoint is public by necessity, so the
  response must not become an oracle for forging a signature: the specifics go
  to the log, not to the caller.
- **Security headers** are set on every response, and a request id is
  propagated (`X-Request-ID`) so a customer report can be matched to a log
  line. An inbound id is reused only if well-formed; otherwise a fresh one is
  generated.
- **Configuration is validated at boot.** `Settings.validate_for_environment()`
  refuses to start in production with a wildcard CORS origin, with docs
  enabled, or with a public URL pointing at localhost, and warns loudly about
  anything merely degraded (no Redis, no database, no email provider). Problems
  surface once, at startup, with the whole picture — not as a 500 three days
  later.

## 12. Performance

- `next/image` with AVIF/WebP and Cloudinary as the remote loader (already
  configured in `next.config.ts`).
- Route-level code splitting is automatic under the App Router; heavy
  client-only libraries (Recharts for dashboards, the image gallery
  lightbox) are dynamically imported (`next/dynamic`) so the marketing/
  marketplace bundle never pays for dashboard-only code.
- Skeleton loaders (`.skeleton` utility) for every data-dependent surface,
  matching the final layout's dimensions to avoid layout shift.

## 13. Phase checklist

- [x] **Phase 1 — Architecture** (this document)
- [x] **Phase 2 — Folder structure & core scaffolding** (config, Prisma
      schema, Supabase clients, middleware, types, design tokens)
- [x] **Phase 3 — Landing page** (hero with parallax/mesh gradient, intelligent
      search bar, categories, featured listings, bento features, animated
      stats, seller CTA, testimonials, FAQ, newsletter, footer)
- [x] **Phase 4 — Authentication** (built on Supabase Auth, since migrated to
      Neon Managed Better Auth — see `docs/auth/`: email/password + Google,
      email verification, forgot/reset password, complete-profile onboarding,
      role-based route protection, RLS policies, avatar storage)
- [x] **Phase 5 — Marketplace core** (17-category taxonomy, full-text
      search with filters/sort/infinite scroll, category pages, product
      detail, listing CRUD with Cloudinary images, favorites, view
      tracking, seller listings management + dashboard stats, API routes)
- [ ] **Phase 6 — Marketplace communication & transactions** (supersedes
      the original Phases 6–8 sketch below — messaging, payments, and
      orders turned out to belong in one phase, not three, since orders
      depend on payments which depend on nothing else being half-built)
  - [x] Schema: `OrderReview`, `Order.sellerId`, `Message` image support,
        expanded `NotificationType`, buyer rating aggregates
  - [x] RLS + Realtime enablement for chat/orders/reviews
        (`manual_phase6_rls_realtime.sql`)
  - [x] Notifications: service layer, email fan-out, bell + center UI,
        wired into favorites/sold triggers
  - [x] Messaging (conversations, Realtime chat, typing/presence, image
        sharing, read receipts, edit/delete, archive/delete, block users,
        conversation search, rate limiting)
  - [x] Payments — **Phase 10, implemented** (the Daraja route handlers were
        removed in Phase 8 and replaced by the provider-agnostic architecture
        in §7; Paystack is the live provider in the Next.js app, PayHero was
        removed as retired — see §7c/§7d)
  - [x] Orders (checkout flow, lifecycle, cancellation, seller order
        management)
  - [ ] Reviews (post-order mutual rating, seller/buyer rating display)
  - [ ] Analytics (views-over-time, conversion rate, top listings)
  - [ ] Moderation (admin report queue, listing suspension, ban)
- [x] **Phase 7 — Security hardening** (CSRF, rate limiting, shared Redis
      client, upload content validation, audit service, theme-init hardening)
- [x] **Phase 8 — Production architecture** (this revision; see §14)
  - [x] Independent FastAPI service in `backend/` with `/api/v1` versioning
  - [x] Environment-driven configuration with production startup validation
  - [x] CORS allowlist, security headers, request-id correlation
  - [x] Structured JSON logging with credential/PII redaction
  - [x] Single error envelope; no stack traces or secrets in responses
  - [x] `/api/v1/health` liveness and `/api/v1/health/ready` readiness
  - [x] Provider-agnostic `Payment` model + migration (renames, not drops)
  - [x] Typed `PaymentProvider` interface + registry (no collection
        adapters registered — see §7c)
  - [x] Storage abstraction (Cloudinary-shaped) with upload policy enforced
  - [x] Email abstraction (Resend adapter) that never fails the caller
  - [x] Supabase token verification abstraction — auth-only boundary (§5)
  - [x] SQLAlchemy mirror of the payments domain, Prisma still owns the DDL
  - [x] 362 backend tests; `prisma/schema.prisma` parsed and compared
  - [x] **Phase 10 — Paystack live, PayHero removed** (hosted checkout +
        signed webhook + server verification in the Next.js app; the Phase 9
        PayHero integration was retired and removed from the repository —
        historical rows and the enum value are retained, §7a)

## 14. Backend service reference (Phase 8)

`backend/` is an independent FastAPI application. It shares the database and the
Upstash Redis instance with Next.js — Redis doubles as the chat realtime fan-out
channel (`app/services/chat_realtime.py`) — but has its own dependency list, its
own environment file and its own deployment. It makes no Supabase call: Neon Auth
JWTs are verified against the provider's published JWKS.

```
backend/
  app/
    main.py            app factory, lifespan, middleware order
    api/
      deps.py          shared dependencies (auth, rate limit, pagination)
      v1/
        router.py      the /api/v1 router
        endpoints/     health.py, payments.py
    core/              config, errors, logging, middleware, security, db, redis
    models/            SQLAlchemy mirror of the payments domain (§6c)
    schemas/           Pydantic request/response models
    services/          payment_service, email_service, rate_limit, health
    providers/
      payments/        base (interface), registry — no collection adapters (§7c)
      storage/         base (interface + shared policy), cloudinary
      email/           base (interface + templates), resend
  tests/               no network, no database, no credentials required
  pyproject.toml       dependencies, pytest and ruff configuration
  .env.example         every variable, commented, all values safe placeholders
```

**Middleware order matters** and is deliberate in `main.py`:
`CORS → RequestContext → SecurityHeaders → ExceptionGuard`. CORS is outermost so
a rejected preflight still gets CORS headers (otherwise the browser reports a
CORS error instead of the real one); `RequestContext` is next so every later
layer — including the exception guard — can attach the request id; the exception
guard is innermost so it sees every failure the app raises.

**Versioning.** All routes live under `/api/v1`. A breaking change means a `v2`
router beside it, never an edit in place: payment integrations are called by
providers whose callback URLs cannot be updated atomically with a deploy.

**Endpoints in the backend.**

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/health` | none | Liveness. Touches no dependency, so it stays up while the database is down — which is exactly when you need it |
| `GET /api/v1/health/ready` | none | Readiness. Probes database and Redis with a 2s cap; returns 503 only when a dependency is genuinely unavailable, and `degraded` (200) when one is merely not configured outside production |
| `GET /api/v1/payments/providers` | none | Registered and reserved providers. Exposes no credentials — `configured` and `available` are booleans, never values |

**Running it.** See README.md. The short version:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Storage and email are abstractions, not integrations.** `StorageProvider`
mirrors the Cloudinary-shaped API the frontend already uses — deliberately not
a Supabase Storage client (§2) — and it enforces the same upload policy
as `src/lib/validations/upload-security.ts` (size, MIME allowlist, magic bytes,
folder traversal, SVG excluded because it is a script container). Transfer
operations are stubbed with 501. `EmailProvider` has one working adapter
(Resend) whose send path **never raises**: a failed notification must not take
down the action that triggered it.
