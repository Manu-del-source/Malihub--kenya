# MaliHub Kenya — existing auth architecture audit

Written **before** any POC code was added, by reading the repository only. No
files were modified during the audit (the only pre-existing gaps found are noted
at the end).

Scope: `package.json`, `src/middleware.ts`, `src/app/(auth)/actions.ts`,
`src/app/(auth)/login/*`, `src/app/(auth)/complete-profile/*`,
`src/services/auth-service.ts`, `src/services/account-provisioning.ts`,
`src/lib/supabase/*`, `src/app/api/auth/callback/route.ts`, the auth tests, and
the Prisma `User`/`Profile`/`Seller` models.

---

## A. What Supabase currently does

Supabase is the **identity provider only** — it is not the application database
(`DATABASE_URL` points at an independent Postgres; `prisma/schema.prisma`
documents this in its header).

| Capability | Where | Notes |
| --- | --- | --- |
| Email/password sign-up | `signUpAction` (`src/app/(auth)/actions.ts`) | Supabase sends the verification email (`emailRedirectTo` → `/api/auth/callback`) |
| Email/password sign-in | `signInAction` | `signInWithPassword`, then a fail-closed onboarding-state sync |
| Google OAuth | `signInWithGoogleAction` | `signInWithOAuth({ provider: "google" })` |
| OAuth / email-link code exchange | `src/app/api/auth/callback/route.ts` | `exchangeCodeForSession(code)`, then `provisionUserRows(...)` |
| Email verification resend | `resendVerificationAction` | `auth.resend({ type: "signup" })` |
| Password reset | `forgotPasswordAction`, `resetPasswordAction` | `resetPasswordForEmail`, then `updateUser({ password })` |
| Session cookies for Next.js | `src/lib/supabase/{client,server,middleware}.ts` | `@supabase/ssr` browser + server clients; server client mirrors rotated cookies |
| Session refresh on every request | `updateSession()` in `src/lib/supabase/middleware.ts` | `supabase.auth.getUser()` per request from `src/middleware.ts` |
| JWT claims used at the edge | `app_metadata { role, has_seller_profile, onboarded }` | written by the **service-role** admin API (`auth.admin.updateUserById`), then `refreshSession()` re-mints the JWT |
| Session refresh after profile completion | `completeProfileAction` | same `refreshSession()` mechanism |

Supabase is **not** used for: application data, marketplace images (Cloudinary),
row-level security enforcement on the Prisma data path, or emails (Resend).

## B. What Neon currently does

- **Neon Postgres is the application database** (`DATABASE_URL`/`DIRECT_URL`,
  Prisma `datasource`), and it is the **source of truth for onboarding/role**:
  `getAuthoritativeOnboardingState()` reads `User.role`, `Profile.onboarded`, and
  the existence of a `Seller` row from Neon, and that state is mirrored into
  Supabase `app_metadata`.
- **Neon Auth (Managed Better Auth) was enabled on the production branch at the
  infra level only.** Before this POC there was **no reference to Neon Auth
  anywhere in the codebase**: no `@neondatabase/*` dependency in
  `package.json`, no `NEON_AUTH_*` variable in `.env.example`, and the only
  "Neon" mentions in `src/` are comments (schema portability notes).

## C. How auth identity → Neon users → profiles is mapped today

```
Supabase Auth user (UUID)            ← credentials, OTP, OAuth, sessions live here
        │  sign-up / sign-in / OAuth callback
        ▼
authIdentityFromSupabaseUser(user)   src/services/account-provisioning.ts
        │  id, email, phone, emailVerified (email_confirmed_at),
        │  fullName (user_metadata.full_name ?? name), avatarUrl
        ▼
ensureUserProvisioned(db, identity)  idempotent upsert on Neon
        ├── users   (id = Supabase UUID, email, phone, email_verified)
        └── profiles (user_id = same UUID, full_name, avatar_url)
        ▼
saveCompletedProfile() (one transaction, `completeProfileAction`)
        ├── re-provision rows (fixes P2025 for fresh accounts)
        ├── users.phone / users.role = BUYER | SELLER
        ├── profiles.full_name / county / avatar_url / onboarded = true
        └── optional starter `sellers` row when accountIntent wants selling
        ▼
syncSupabaseAppMetadata()            mirror into Supabase app_metadata
        └── admin.updateUserById(id, { app_metadata: { role, has_seller_profile, onboarded } })
        ▼
refreshSession()                     re-mint the browser JWT so middleware sees new claims
```

Key properties:

- **`User.id` is the Supabase auth UUID** (`String @id @db.Uuid`), not a
  Prisma-generated id — the row *is* the mirror of the identity.
- Provisioning is **application-owned** (the old Supabase `auth.users` trigger
  cannot fire on an independent Postgres — see the module header of
  `account-provisioning.ts`).
- The identity → rows mapping is **structural**, not SDK-typed
  (`SupabaseIdentityUser` is a structural subset), so the mapper is portable.
- `users.email` is **non-null unique**; provisioning refuses an identity without
  an email (`AuthServiceError`).

## D. Which parts of middleware depend on Supabase

`src/middleware.ts` runs on every non-static request and depends on Supabase in
exactly one place — the very first line:

```ts
const { response, user } = await updateSession(request);   // src/lib/supabase/middleware.ts
```

`updateSession()` creates a cookie-backed Supabase server client, calls
`supabase.auth.getUser()`, and mirrors rotated auth cookies onto both the request
and the response. Everything else in middleware is **claim logic** and would
survive any identity provider *if* the claims exist:

1. signed-out + `/dashboard/{seller,buyer,admin}` → redirect `/login?redirectTo=…`
2. `app_metadata.onboarded !== true` → force `/complete-profile` (except an
   exempt list: profile, password reset, verify-email, `/api`)
3. signed-in + onboarded + an auth route (`/login`, `/register`, …) → `/dashboard/buyer`
4. `/dashboard/admin` requires `app_metadata.role ∈ {ADMIN, SUPER_ADMIN}`
5. `/dashboard/seller` requires `app_metadata.has_seller_profile === true` (or admin)

So: **the Supabase dependency is the session source; the authorization model is
`app_metadata`.**

## E. Which parts of the application depend on `app_metadata`

`app_metadata` is a **Supabase-only** concept (it is embedded in the Supabase
JWT). It is read and written here:

- **Read at the edge** — `src/middleware.ts` (all five checks in §D use
  `user.app_metadata`).
- **Written** — `syncSupabaseAppMetadata()` in `src/services/auth-service.ts`
  (service-role `auth.admin.updateUserById`), called from:
  - `completeUserProfile()` — after the Neon transaction commits (best-effort), and
  - `signInAction` — repairs stale claims, then `refreshSession()` re-mints the
    JWT; if the sync fails the action **fails closed** and clears the session.
- **Tests that pin the behaviour** — `src/__tests__/middleware.test.ts`,
  `src/app/(auth)/__tests__/sign-in-action.test.ts`,
  `src/app/(auth)/__tests__/complete-profile-action.test.ts`.

No other module reads `app_metadata`. `user_metadata` is read only in
`/complete-profile` for `full_name`/`avatar_url` defaults.

## F. What can remain unchanged if Neon Auth becomes the identity provider

Unchanged (identity-agnostic):

- the entire Prisma schema and every migration — `account-provisioning.ts`
  already takes an `AuthIdentity { id, email, phone, emailVerified, fullName, avatarUrl }`
  and a data store, and never imports the Supabase SDK;
- marketplace/dashboard/API/notification/messaging/search logic;
- Cloudinary uploads, Resend email, Upstash rate limiting, the FastAPI backend's
  data path;
- `getAuthoritativeOnboardingState()` — the "Neon is the authority" pattern stays.

Must change (or be replaced) for a real migration:

- `src/lib/supabase/*` clients and `updateSession()` — the session source;
- `src/app/(auth)/actions.ts` + `src/app/api/auth/callback/route.ts` — Supabase
  SDK calls (`signUp`, `signInWithPassword`, OAuth, `resetPasswordForEmail`,
  `updateUser`, `resend`, `exchangeCodeForSession`);
- `syncSupabaseAppMetadata()` + the `app_metadata` claim contract used by
  `src/middleware.ts` — Better Auth has no `app_metadata`; equivalent
  authorization state would have to come from a server-side session read
  (Neon/Prisma) or a signed claim of our own;
- `User.id` typing — Supabase ids are UUIDs, Better Auth ids are not (§N of the
  report).

## Gaps found while auditing

- **`src/services/auth-errors.ts` does not exist.** The pieces it would hold live
  in `account-provisioning.ts` (`AuthServiceError`) and `(auth)/actions.ts`
  (`mapSupabaseError`). Nothing to migrate.
- Auth tests are `node:test` based (`npm test` = `node --import tsx
  --experimental-test-module-mocks --test "src/**/*.test.ts"`), currently
  **7 suites / 32 tests, all passing** before the POC.
