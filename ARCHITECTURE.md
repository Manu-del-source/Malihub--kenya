# MaliHub Kenya — System Architecture

Phase 1 of the build plan. This document is the source of truth for how the
pieces fit together; every later phase implements against it.

## 1. Goals & non-goals

**Goals:** a premium, fast, accessible Kenyan marketplace (Apple/Airbnb/Stripe
register, not Jiji's), with real mobile-money payments behind a
provider-agnostic interface (PayHero first, direct Daraja reserved), three
distinct dashboards (seller/buyer/admin), and a data model that scales past
the MVP.

**Non-goals for v1:** multi-currency, multi-country, native mobile apps,
real-time video, and a custom-built chat infra (v1 messaging is DB-backed
polling/subscriptions via Supabase Realtime, not a bespoke socket server —
`socket.io-client` is in the dependency list for a later upgrade path only).

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
             │  Supabase Auth        │
             │  identity ONLY:       │
             │  credentials, sessions│
             │  OAuth, JWT issuance  │
             └───────────────────────┘

             ┌───────────────────┐   ┌────────────────────────┐
             │  Cloudinary       │   │  Payment providers     │
             │  (image storage + │   │  PayHero (Phase 9)     │
             │   transforms)     │   │  Daraja (reserved)     │
             └───────────────────┘   └────────────────────────┘
```

**The Supabase boundary is authentication.** Supabase issues and verifies user
sessions, and there is no second auth system and no second password store
anywhere in this repository. Concretely:

- **Supabase is not the application database.** Application data lives in an
  independent PostgreSQL instance, reached through Prisma from Next.js and
  through a read/write mirror from FastAPI. Hosting that Postgres *on* Supabase
  remains possible, but nothing in the code depends on it: no Supabase-specific
  database feature is used, so any standard managed PostgreSQL 13+ (Neon, RDS,
  …) works unchanged. See §6c.
- **Supabase is not the file store for anything new.** Marketplace images go to
  Cloudinary, and the backend's `StorageProvider` abstraction (§14) is
  Cloudinary-shaped for that reason — deliberately not a Supabase Storage
  client. One Phase 4 exception survives: profile **avatars** use a Supabase
  Storage bucket (`src/components/auth/avatar-upload.tsx`, created by
  `manual_storage_avatars.sql`). It is working functionality and was left
  alone; the rule is that nothing *new* is built on it, and a future phase may
  consolidate avatars onto Cloudinary rather than grow the exception.
- **Supabase tokens are consumed, never issued, by the backend** (§5).

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

- Supabase Auth owns credentials, email verification, password reset, and
  Google OAuth. Prisma's `User`/`Profile` tables mirror `auth.users` by
  sharing the same UUID primary key — a Postgres trigger
  (`on_auth_user_created`) inserts the mirror rows so application code never
  has to remember to do it manually.
- **Role** (`BUYER | SELLER | ADMIN | SUPER_ADMIN`) is stored in Prisma
  *and* mirrored into the Supabase JWT via `app_metadata` (set through a
  Supabase Edge Function / admin API call on role change), so middleware can
  read the role straight off the JWT at the edge without a DB round trip.
  Anything security-sensitive still re-checks the role server-side — the JWT
  claim is a fast path for UX redirects, not the authorization boundary.
- **Authorization boundary** = Postgres Row Level Security policies (keyed
  off `auth.uid()`) + explicit ownership checks in Server Actions. Prisma
  itself doesn't enforce RLS (it connects as a privileged role for app
  queries), so every mutation Server Action re-verifies `ownerId === session
  user id` before writing — RLS is the backstop for anything that reaches
  Postgres another way (Supabase client calls, direct API access).
- Middleware (`src/middleware.ts`) refreshes the session cookie every request
  and redirects: signed-out users away from `/dashboard/*`, signed-in users
  away from auth pages, non-admins away from `/dashboard/admin/*`.
- **The FastAPI backend consumes Supabase tokens; it never issues them.**
  A `TokenVerifier` abstraction (`backend/app/core/security.py`) accepts the
  `Authorization: Bearer <supabase jwt>` header and validates it either by
  shared secret (HS256, `SUPABASE_JWT_SECRET`) or by JWKS
  (`SUPABASE_JWKS_URL` + an asymmetric algorithm). There is deliberately no
  second sign-in path, no local password store, and no session table: if
  Supabase did not issue the token, the backend rejects it.
  - A `service_role` JWT presented as a user token is **refused with 403**.
    That key is a server-side admin credential and must never arrive from a
    browser; accepting it would turn any leaked anon-side token into full
    admin access.
  - The role is read from `app_metadata.role`, matching §5 — the JWT claim is
    the fast path, and anything security-sensitive re-checks it.
  - Tokens are accepted **only** from the `Authorization` header, never from a
    cookie or a query string: a token in a URL lands in access logs, browser
    history and `Referer` headers.
  - If neither verification mode is configured the backend fails **closed** —
    every authenticated route returns 503 rather than treating requests as
    anonymous. In production this is a startup error, not a runtime one.

## 5a. Auth implementation notes (Phase 4)

- **Buyer/Seller/Both is not a fourth enum value.** `User.role` stays
  `BUYER` or `SELLER` (`ADMIN`/`SUPER_ADMIN` are staff-only, set manually,
  never through signup). Buying is never role-gated — anyone can buy
  regardless of role. Choosing "Seller" or "Both" at /complete-profile sets
  `role = SELLER` **and** creates a starter `Seller` row (business name
  defaults to their full name, editable later); "Both" doesn't block
  buying, it's purely a UI/copy distinction on top of the same `SELLER`
  role + Seller row. Seller-dashboard access is gated on **having a
  Seller row**, not on the role string.
- **Two-tier role check**: `app_metadata.role` / `app_metadata.has_seller_profile`
  / `app_metadata.onboarded` are mirrored into the JWT (via the Supabase
  Admin API in `completeUserProfile`) so `middleware.ts` can gate
  `/dashboard/*` at the edge with zero DB round trips. This is a fast path,
  not the authorization boundary — Server Actions re-verify ownership
  against Postgres directly, and RLS (§11, `manual_rls_policies.sql`) is
  the backstop for anything that reaches Postgres another way.
- **Onboarding is enforced in middleware**, not just the complete-profile
  page: any authenticated user with `app_metadata.onboarded !== true` is
  redirected to `/complete-profile` from anywhere except that page itself,
  `/forgot-password`, `/reset-password`, `/verify-email`, and `/api/*`.
- **One callback route for three flows**: `/api/auth/callback` handles
  Google OAuth, email verification links, and password recovery links —
  all three are Supabase's `?code=` exchange flow, differentiated only by
  the `?next=` param each flow sets when it kicks off.
- **Avatar photos use Supabase Storage**, not Cloudinary — they're
  tightly coupled to the auth/profile flow that's already talking to
  Supabase, and Cloudinary's signed-upload flow is unnecessary complexity
  for a single small image. Product images (Phase 5) still use Cloudinary
  per the original stack.
- **Manual SQL migrations required**: `manual_auth_trigger.sql` (mirrors
  `auth.users` → `public.users`/`profiles`), `manual_rls_policies.sql`, and
  `manual_storage_avatars.sql` must all be run against Supabase Postgres —
  see README for the exact steps. None of this is optional; the app will
  not function without the trigger in particular, since there's no other
  code path that creates the `public.users`/`profiles` mirror rows.

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
- **Avatar photos: Supabase Storage (Phase 4). Listing photos: Cloudinary**
  (`next-cloudinary`'s unsigned upload widget, `NEXT_PUBLIC_CLOUDINARY_
  UPLOAD_PRESET`) — per the original stack choice, now actually wired up.

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
- **Realtime is scoped to `chats`/`messages` only.** Everything else
  (notifications, favorites, listing stats) uses polling or plain
  request/response — adding Realtime to every table would multiply
  client-side subscription overhead for features where a few seconds of
  staleness is genuinely fine. Chat is the one place users perceive lag
  directly, turn by turn, the way they would in any messaging app.
- **RLS now covers `chats`/`messages`/`orders`/`order_items`/`payments`/
  `order_reviews`** (`manual_phase6_rls_realtime.sql`), on top of Phase
  4's user-data policies. Order/payment tables get *read* policies only —
  every write to those tables goes through Prisma Server Actions (checkout,
  the M-Pesa callback) on the privileged connection, so there's nothing
  for the anon/authenticated roles to need insert/update access for.

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
  not Row Level Security. RLS remains in place for the Supabase-client read
  paths (§5), but no new feature depends on it — which is what allows the
  backend to connect with an ordinary application role.
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
*rail*, Daraja and PayHero are *processors* on it, and the original schema
conflated the two — `PaymentMethod.MPESA` named a processor where a channel
belonged, and every column was prefixed `mpesa`. Adding a card processor to
that schema is a migration and a rewrite; adding one to this schema is an
adapter.

### 7a. The model

`Payment` records *which processor moved the money*, separately from *which
channel the customer used*:

| Field | Meaning |
| --- | --- |
| `provider` | `PAYHERO` · `DARAJA` (reserved) · `MANUAL` — the processor |
| `method` | `MOBILE_MONEY` · `CARD` · `BANK_TRANSFER` · `CASH_ON_DELIVERY` — the channel |
| `status` | `PENDING → PROCESSING → SUCCESS / FAILED / CANCELLED / REFUNDED` |
| `amountCents` | Integer minor units. Never a float, never a provider-formatted string (§6) |
| `currency` | ISO 4217, default `KES` |
| `providerTransactionId` | The processor's own id (PayHero `transaction_id`, Daraja `CheckoutRequestID`). Unique — this is the idempotency key a retried callback is matched against |
| `providerReference` | The settlement/receipt reference a customer can quote to their bank or operator. Unique |
| `customerReference` | *Our* reference (the order number), echoed back in callbacks. Required — a Payment always comes from a known Order |
| `payerReference` | Provider-reported payer handle, normalized (an MSISDN, a masked PAN). The one piece of payer PII on the row, kept because support and refunds genuinely need it, and never logged (§11) |
| `metadata` | Opaque provider-specific detail as JSON. Not indexed, not queried |
| `failureCode` / `failureReason` | Normalized failure signalling. `failureCode` is a string on purpose: Daraja reports integers (`0` accepted, `1032` cancelled), PayHero reports string statuses — a string column holds both without a lossy cast, and the adapter owns the translation |
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
adapter. `DARAJA` and `MANUAL` are **reserved**: the enum values exist so
adding them is a code change rather than a destructive enum migration, but no
adapter is registered and requesting one returns an explanation, not a 500.

### 7c. What Phase 8 does *not* do

This is a deliberate boundary, and it is enforced by tests rather than by
convention:

- **No PayHero API calls.** `PayHeroProvider` is a typed stub. Every operation
  raises `NotImplementedFeatureError` → HTTP 501. It reports
  `available = false` even when credentials are present, because *configured*
  and *working* are different claims and conflating them is how a half-built
  integration reaches production.
- **No STK Push, no Daraja, no Safaricom callbacks.** The Phase 7 Daraja route
  handlers (`/api/mpesa/*`) are removed. No `MPESA_*` variable is read by
  anything in this repository.
- **No payment-mutating endpoint.** The only payment route in Phase 8 is
  `GET /api/v1/payments/providers`, which reports registered and reserved
  providers and exposes no credentials. There is no initiate endpoint and no
  webhook route — a webhook route that cannot verify a signature is worse than
  no webhook route.
- **No production payment credentials**, real or placeholder-shaped.
  `PAYHERO_ENABLED` defaults to `false` and every credential in
  `.env.example` is empty.
- **No persistence in the service layer.** `PaymentService` orchestrates
  providers and returns typed results; it does not write rows yet, because
  there is no flow to write them from.

Phase 9 implements PayHero for real: sandbox credentials, STK Push, a
signature-verifying webhook endpoint, idempotent callback processing, and the
order/notifications side effects below.

### 7d. The flow, once implemented (Phase 9)

1. Buyer confirms order → `Order` (`PENDING`) and `Payment` (`PENDING`,
   `provider = PAYHERO`, `method = MOBILE_MONEY`).
2. The backend calls the provider's `initialize()` with the buyer's MSISDN
   (normalized to `2547XXXXXXXX` by `toKenyanMsisdn()` in `src/utils`), the
   amount in cents, and `customerReference` = order number.
3. The provider responds with its transaction id, stored on the `Payment` row
   **immediately** — the callback can arrive before the initiate response does,
   a race the providers' own docs warn about.
4. The provider posts a callback to the backend's webhook route. The handler
   verifies the signature over the raw bytes, looks up the `Payment` by
   `providerTransactionId`, stores `rawCallbackPayload`, and applies the
   transition **idempotently**: a payment already in a terminal status
   (`SUCCESS`, `FAILED`, `CANCELLED`, `REFUNDED`) is a no-op, because providers
   retry callbacks and a retry must not settle twice or notify twice.
5. On `SUCCESS`: `Order.status → PAID`, notifications for buyer and seller
   (§8), and a receipt from `providerReference`.
6. **Failed payment recovery:** the buyer sees "Retry Payment", which reuses the
   same `Order` with a new `Payment` row and increments `retryCount`.
7. A **reconciliation sweep** polls `check_status()` for any payment stuck in
   `PENDING`/`PROCESSING` past a timeout — the case where the callback never
   arrives. The `payments_provider_status_idx` index exists for exactly this
   query, which is provider-scoped by nature.

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

- **One Realtime channel per chat**, combining three concerns Supabase
  usually shows as separate examples (`postgres_changes`, `broadcast`,
  `presence`) — each channel is its own websocket subscription, so
  opening three per conversation would triple the connection overhead
  for no benefit. `useChatRealtime` (`hooks/use-chat-realtime.ts`) owns
  all three.
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
  `src/lib/supabase/server.ts` and only ever imported by webhook handlers and
  admin-only Server Actions — never by anything reachable from a Client
  Component bundle.
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
- [x] **Phase 4 — Authentication** (Supabase Auth: email/password + Google,
      email verification, forgot/reset password, complete-profile onboarding,
      role-based route protection, RLS policies, avatar storage)
- [x] **Phase 5 — Marketplace core** (16-category taxonomy, full-text
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
  - [ ] Payments (deferred to Phase 9 — the Daraja route handlers were
        removed in Phase 8 and replaced by the provider-agnostic
        architecture in §7; PayHero is the first live integration)
  - [ ] Orders (checkout flow, lifecycle, seller order management)
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
  - [x] Typed `PaymentProvider` interface, registry, `PayHeroProvider` stub
  - [x] Storage abstraction (Cloudinary-shaped) with upload policy enforced
  - [x] Email abstraction (Resend adapter) that never fails the caller
  - [x] Supabase token verification abstraction — auth-only boundary (§5)
  - [x] SQLAlchemy mirror of the payments domain, Prisma still owns the DDL
  - [x] 362 backend tests; `prisma/schema.prisma` parsed and compared
  - [ ] PayHero integration — **Phase 9** (real API calls, STK Push,
        signature-verifying webhook, persistence, order side effects)

## 14. Backend service reference (Phase 8)

`backend/` is an independent FastAPI application. It shares the database, Redis
and Supabase project with Next.js but has its own dependency list, its own
environment file and its own deployment.

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
      payments/        base (interface), payhero (stub), registry
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

**Endpoints in Phase 8.**

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
