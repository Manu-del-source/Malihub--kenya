# MaliHub Kenya — System Architecture

Phase 1 of the build plan. This document is the source of truth for how the
pieces fit together; every later phase implements against it.

## 1. Goals & non-goals

**Goals:** a premium, fast, accessible Kenyan marketplace (Apple/Airbnb/Stripe
register, not Jiji's), with real M-Pesa payments, three distinct dashboards
(seller/buyer/admin), and a data model that scales past the MVP.

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
│  │ (data reads,   │  │ (forms, cart,  │  │ (mutations, webhooks, │    │
│  │  RSC-first)    │  │  motion, chat) │  │  Daraja callbacks)     │    │
│  └───────┬───────┘  └───────┬───────┘  └───────────┬───────────┘    │
│          │                  │                       │                │
│          └────────────┬─────┴───────────┬───────────┘                │
│                        │                 │                            │
└────────────────────────┼─────────────────┼────────────────────────────┘
                         │                 │
              ┌──────────▼──────┐   ┌──────▼───────────┐
              │  Prisma Client    │   │  Supabase Auth    │
              │  (app data:       │   │  (identity,       │
              │  products, orders,│   │   sessions,        │
              │  payments, etc.)  │   │   OAuth, RLS)      │
              └──────────┬────────┘   └──────┬────────────┘
                         │                    │
              ┌──────────▼────────────────────▼───────────┐
              │        Supabase Postgres (single DB)       │
              └──────────┬──────────────────────┬──────────┘
                         │                       │
              ┌──────────▼───────┐   ┌───────────▼───────────┐
              │  Cloudinary       │   │  M-Pesa Daraja API     │
              │  (image storage + │   │  (STK Push, callbacks, │
              │   transforms)     │   │   B2C/reconciliation)  │
              └───────────────────┘   └────────────────────────┘
```

Single Postgres instance (Supabase) serves both Supabase Auth (`auth.users`)
and application data (`public.*` via Prisma). This avoids the two-databases-
that-drift-apart failure mode common in Supabase+Prisma stacks.

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

## 7. Payments: M-Pesa Daraja integration

Flow for a checkout:

1. Buyer confirms order → Server Action creates `Order` (status `PENDING`)
   and `Payment` (status `PENDING`, method `MPESA`).
2. Server Action calls the Daraja **STK Push** endpoint (`services/mpesa.ts`,
   built in Phase 8) with the buyer's MSISDN (normalized via
   `toMpesaMsisdn()`), amount, and `AccountReference` = order number.
3. Daraja responds synchronously with a `CheckoutRequestID` — stored on the
   `Payment` row immediately so the callback can be matched even if it
   arrives before the STK push response does (race condition Safaricom's
   docs explicitly warn about).
4. Safaricom calls back to `POST /api/mpesa/callback` (a Route Handler, not
   a Server Action, since it's an external POST with no browser session).
   The handler: verifies the payload shape, looks up the `Payment` by
   `mpesaCheckoutRequestId`, and updates status to `SUCCESS`/`FAILED` —
   **idempotently** (checked by `resultCode` already being set) since
   Safaricom retries callbacks.
5. On `SUCCESS`: `Order.status → PAID`, a `Notification` is created for the
   buyer and seller, and a receipt is generated from the stored
   `mpesaReceiptNumber`.
6. **Failed payment recovery:** failed/timeout payments surface a "Retry
   Payment" action that reuses the same `Order` with a new `Payment` row
   (never mutates a failed one, preserving the audit trail) and increments
   `retryCount`.
7. A **query job** (`/api/mpesa/query`, invoked by a scheduled function) polls
   Daraja's transaction status endpoint for any `Payment` stuck in
   `PENDING`/`PROCESSING` past a timeout — covers the case where the callback
   never arrives (network blip on Safaricom's side).

## 8. Notifications

- `Notification` rows are the single source of truth; `channel` decides
  whether an email is also fanned out via Resend at creation time.
  In-app notifications are read via a lightweight polling hook
  (`useNotifications`, React Query, 30s interval) in Phase 6 — an upgrade to
  Supabase Realtime subscriptions is a drop-in replacement later since the
  data shape doesn't change.
- Triggers: order status change, payment success/failure, new chat message,
  wishlist item back-in-stock or price-drop, listing approved/rejected.

## 9. Search & discovery

- Primary search: Postgres `tsvector` (section 6) via a Prisma
  `$queryRaw` call ranked with `ts_rank`.
- Filters (category, price range, county, brand, condition) compose as
  additional `WHERE` clauses — combinable with search or standalone.
- Sort options (`newest`, `price_asc`, `price_desc`, `most_viewed`) map to
  `ORDER BY` clauses; cursor-based pagination (`createdAt` + `id` compound
  cursor) powers infinite scroll without the page-drift issues of
  offset pagination on a frequently-inserted table.

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

- Service-role Supabase client (`createServiceRoleClient`) is isolated to
  `src/lib/supabase/server.ts` and only ever imported by webhook handlers and
  admin-only Server Actions — never by anything reachable from a Client
  Component bundle.
- M-Pesa callback endpoint validates the source (Safaricom's published IP
  ranges, checked in Phase 8) in addition to payload shape, since it's an
  unauthenticated public endpoint by necessity.
- Rate limiting (Upstash Redis, optional env vars already scaffolded) on
  auth endpoints and the STK push trigger, to prevent OTP-bombing a phone
  number or hammering Daraja's sandbox rate limits.
- Every Server Action re-validates input with the same Zod schema used on
  the client — client validation is UX, server validation is the actual
  boundary.

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
- [ ] Phase 5 — Marketplace (browse/search/product detail)
- [ ] Phase 6 — Dashboards (seller/buyer/admin)
- [ ] Phase 7 — Supabase integration hardening (RLS policies, triggers, seed)
- [ ] Phase 8 — M-Pesa Daraja integration
- [ ] Phase 9 — Performance pass
- [ ] Phase 10 — Deployment prep
