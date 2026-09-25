# MaliHub Kenya — Supabase Auth → Neon Auth Migration

**Companion document:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how auth works now

This is the operational document: what changed, what an operator must do before
this can serve traffic, how existing users are handled, and how to go back.

---

## 1. Scope — what was done, and what deliberately was not

### Done

| Area | Change |
|---|---|
| Schema | added `users.auth_user_id TEXT UNIQUE` (nullable) + one additive migration |
| Abstraction layer | new `src/lib/auth/` (8 modules); `neon.ts` is the only SDK importer |
| Middleware | rewritten — authentication only, single provider path, fails closed |
| Authorization | new guard layer reading MaliHub's Postgres rows |
| Server Actions | all 8 rewritten + `verifyEmailWithCodeAction` added |
| Call sites | ~25 pages/layouts/actions/route handlers rewired off `supabase.auth.*` |
| `app_metadata` | **removed** — no claim cache, no session re-minting |
| POC | `/neon-auth-test`, `src/lib/neon-auth/` and their tests deleted |
| `/api/auth/callback` | retired → 410 Gone |
| `/verify-email` | rebuilt with both the link and the code path |
| `/reset-password` | now token-driven, works while signed out |
| Tests | 71 → 209, including real-SDK integration coverage |
| Docs | this file, `ARCHITECTURE.md`, root `ARCHITECTURE.md` §5/§5a, `.env.example` |

### Deliberately NOT done

| Not done | Why |
|---|---|
| **No user migration.** No existing account was moved, mapped, or altered. | Out of scope and irreversible if wrong. The strategy is §4; executing it is an operator decision. |
| No production environment variable was changed. | Not ours to change. §3 lists what must be set. |
| No Neon Console configuration (Google OAuth, email provider, trusted domains). | Requires console access. §5–§6 are the checklist. |
| Nothing deployed, pushed, or merged. | Work is on branch `arena/01a0d6e7-malihub-kenya`. |
| Supabase packages not removed, Supabase project not touched. | Still used for Storage (avatars) and Realtime (chat) — see §10. |
| No destructive database migration. | The one migration adds a nullable column. |
| No Next.js or unrelated dependency upgrades. | Out of scope. |
| The FastAPI backend was not modified. | Different service, own deploy. §7 says exactly what it needs. |

---

## 2. The schema change

```prisma
model User {
  id         String  @id @default(uuid()) @db.Uuid
  authUserId String? @unique @map("auth_user_id")
  // …
}
```

Migration: `prisma/migrations/20260925000000_add_auth_user_id_mapping/`

```sql
ALTER TABLE "users" ADD COLUMN "auth_user_id" TEXT;
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");
```

Properties that make this safe to run at any time:

- **Nullable** — every existing row gets `NULL`, meaning "not yet mapped to a Neon
  Auth identity". No row is invalid afterwards.
- **Additive** — nothing is renamed, retyped, or dropped. No rewrite of `users`.
- **A unique index on a nullable column allows many NULLs** in Postgres, so all
  legacy rows coexist unmapped.
- **No lock hazard worth noting** on a table this size; `ADD COLUMN` with no
  default is metadata-only, and `CREATE UNIQUE INDEX` takes a share lock. Run it in
  a quiet window if `users` is large, or use `CREATE UNIQUE INDEX CONCURRENTLY` in a
  hand-applied step.

`users.id` remains `String @id @db.Uuid`. **It is not the provider's id and must
never be set to one** — every foreign key in the schema targets it, and tying it to
an external system would turn the next provider change into a database rewrite.
`ARCHITECTURE.md` §3.

### Rolling the schema change back

```sql
DROP INDEX IF EXISTS "users_auth_user_id_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "auth_user_id";
```

Safe while no user has been mapped. Once mappings exist, dropping the column
orphans them — which is exactly what §9 covers.

---

## 3. Environment variables

Added (see `.env.example` for the annotated block):

```bash
NEON_AUTH_BASE_URL=          # Neon Console → Project → Branch → Auth → Configuration
NEON_AUTH_COOKIE_SECRET=     # 32+ characters, STABLE across deploys
MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL=false
```

- `NEON_AUTH_URL` is accepted as an alias for the base URL (it is the label the
  Console shows).
- **Server-side only.** Neither may be exposed through `NEXT_PUBLIC_*` — browser
  code talks to MaliHub's own Server Actions, never to the auth service.
- **The cookie secret signs the SDK's local `session_data` cookie.** Rotating it
  silently invalidates every active session, which users experience as "MaliHub
  keeps signing me out". Generate once, store in the secret manager, never derive
  from a build id.
- Values shorter than 32 characters, and placeholders copied from `.env.example`
  (`your-…`, `<…>`, `changeme`, anything that is not an `http(s)` URL), are
  **rejected at configuration time** rather than passed to the SDK to throw on at
  request time. A half-configured deployment fails closed with a redirect to
  `/login` and a `console.error`, not an opaque edge 500.

Supabase variables are **still required** — Storage and Realtime use them (§10).

### The build-time trap

Any route that reads a session must declare `export const dynamic =
"force-dynamic"` (all of them do). Without it, **a build run without
`NEON_AUTH_BASE_URL` prerenders protected pages as static redirects to `/login`**
and the marketing header as permanently signed-out. The declaration removes the
dependency on build-time environment entirely.

If you build in CI, verify the route table: auth-dependent routes must show
`ƒ (Dynamic)`. `ARCHITECTURE.md` §6.

---

## 4. Existing users — the migration strategy (NOT executed)

**Nothing has been migrated.** Every existing `users` row has
`auth_user_id = NULL`, and no Neon Auth account exists for any current customer.
This section is the plan; running it is an operator decision with a real downtime
and support cost, and it should not happen implicitly as a side effect of a deploy.

### The problem

Credentials cannot be copied. Passwords live in Supabase's `auth.users` as bcrypt
hashes MaliHub cannot read or re-hash, and Neon Auth will not import them. So there
is no "move the users" operation — every existing customer must end up with a Neon
Auth credential at some point.

### Recommended: lazy claim on first sign-in, driven by email

The mechanism is already built and tested. It needs no bulk job and no downtime.

1. **Deploy with `MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL=false`.** A legacy customer
   who tries to sign in with their old password gets *"That email or password
   doesn't look right"* (there is no Neon Auth account), and one who registers
   fresh gets *"That email is already linked to a MaliHub account that hasn't been
   moved to the new sign-in system yet. Please contact support."* Neither creates a
   duplicate account, and neither silently attaches anybody's history to a new
   identity.
2. **Announce the change and open a "set your new password" flow.** The cleanest
   version reuses what already exists: send every legacy customer a password-reset
   email. `forgotPasswordAction` → emailed link → `/reset-password?token=…`. For
   this to reach people who have no Neon Auth account yet, they must first be
   created there — see step 3.
3. **Create the Neon Auth accounts.** Use the admin API
   (`admin/create-user`, exposed by the installed SDK) or the Console's bulk import,
   keyed on the email address from `users`. Passwords cannot be carried over, so
   either create them with a forced-reset flag or create them and immediately issue
   reset links.
4. **Turn linking ON for the cutover window.**
   `MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL=true`. Now the first successful Neon Auth
   sign-in for `alice@example.com` **claims** the existing `users` row: it fills
   `auth_user_id`, and keeps `users.id`, role, phone, orders, listings, messages and
   wishlist exactly as they were. Only the mapping column is written.
5. **Turn linking OFF again** once the mapped population has converged. Leaving it
   on indefinitely means any future Neon Auth registration can claim an unmapped
   legacy row by email — which is only safe while you control who is registering.

### Why the flag defaults to OFF

Claiming by email trusts that whoever controls the mailbox controls the account.
That is the same assumption password reset makes, so it is not unreasonable — but
it is a *decision*, and it should be made for a defined window by a person, not
left on by default forever. With the flag off, the failure mode is a support
conversation. With it on and unmonitored, the failure mode is an account takeover.

### Safety properties (all covered by tests)

- A row already mapped to a **different** provider identity is **never**
  reassigned, even with linking on. That would be a takeover path.
- Claiming writes **only** `auth_user_id`. Id, role, phone, name and county are
  untouched — a returning seller is still a seller.
- Linking is refused when the email is absent, and a typo in the flag
  (`"ture"`, `"maybe"`) reads as OFF.
- Duplicate accounts are prevented rather than merged after the fact: with the flag
  off, a colliding email is rejected outright.

### Alternatives considered

| Option | Verdict |
|---|---|
| Bulk-copy Supabase password hashes into Neon Auth | Not possible — no hash import, and the formats are not interchangeable. |
| Keep Supabase Auth running in parallel and federate | Rejected. Two live identity providers means two session stores, two claim models, and the exact ambiguity this migration removes. |
| Force every user to register fresh, then merge by email later | Rejected. Merging two accounts' orders and listings after the fact is far harder and far riskier than claiming an unmapped row once. |
| Big-bang cutover with a maintenance window | Possible but unnecessary — the lazy claim needs no downtime. |

### Measuring progress

```sql
SELECT count(*) FILTER (WHERE auth_user_id IS NOT NULL) AS mapped,
       count(*) FILTER (WHERE auth_user_id IS NULL)     AS legacy
FROM users;
```

---

## 5. Google OAuth prerequisites

Google sign-in will not work until the Console and the Google Cloud project agree
on these. Both are outside the repository.

1. **Authorized redirect URI in Google Cloud Console** must be
   ```
   {NEON_AUTH_BASE_URL}/callback/google
   ```
   This is the auth service's own endpoint — **not** a MaliHub route. The old
   `/api/auth/callback` is retired and answers 410; pointing Google at it will fail.
2. **Trusted domains on the Neon branch** must include every origin MaliHub passes
   as `callbackURL`. `signInWithGoogleAction` builds it as
   `${origin}${target}` from the request's host (or `NEXT_PUBLIC_APP_URL`). Preview
   deployments need a wildcard entry, or Google sign-in fails only on previews —
   which is easy to miss and easy to mistake for a code bug.
3. `target` is passed through `safeInternalRedirect()` first, so a crafted `next`
   parameter cannot smuggle an external origin into the callback.

The action asks the service for the authorize URL with `disableRedirect: true` and
hands it to Next's `redirect()`. Without that flag the service answers with a
`Location` header that our server-side `fetch` would follow, and the browser would
never reach Google.

---

## 6. Production go-live checklist

**Neon Console**
- [ ] Auth enabled on the target branch
- [ ] `NEON_AUTH_BASE_URL` and a 32+ char `NEON_AUTH_COOKIE_SECRET` in the secret manager
- [ ] Email/password auth enabled
- [ ] Google OAuth configured, redirect URI per §5
- [ ] Trusted domains include production **and** preview origins
- [ ] **Custom email provider configured** if verification LINKS are wanted.
      Without it only verification CODES are available — `/verify-email` handles
      that automatically, but the link path will never fire.
- [ ] Password-reset `redirectTo` origin (`https://<app>/reset-password`) trusted

**Application**
- [ ] `prisma migrate deploy` applied (`20260925000000_add_auth_user_id_mapping`)
- [ ] `MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL=false` for launch
- [ ] Build route table shows `ƒ (Dynamic)` for `/`, `/notifications`, `/buyer/*`,
      `/seller/*`, `/messages/*`, `/complete-profile`, `/verify-email` (§3)
- [ ] Supabase variables still present — Storage and Realtime need them (§10)
- [ ] FastAPI backend re-pointed per §7 **before** the app goes live, or its
      authenticated routes will reject every token

**Verification (staging, then production)**
- [ ] Register → `/verify-email` → verify (link **and** code paths) → `/complete-profile` → dashboard
- [ ] Sign in as buyer → `/dashboard/buyer`; as seller → `/dashboard/seller`
- [ ] Sign out → protected route redirects to `/login?redirectTo=…` → sign in lands back there
- [ ] Google sign-in from a fresh account and from an existing one
- [ ] Forgot password → email → `/reset-password?token=…` → new password works, old does not
- [ ] Expired token (wait 15 min) → "Link expired" card, not a crash
- [ ] Banned account → redirected away from `/dashboard/*`, and to `/` not `/login`
- [ ] Non-seller visiting `/seller` → `/dashboard/buyer`
- [ ] Non-admin visiting `/admin` → refused
- [ ] `//evil.example` as `redirectTo` → falls back to the dashboard
- [ ] **Fail-closed drill:** unset `NEON_AUTH_BASE_URL`, rebuild → protected routes
      redirect to `/login`, public pages still render, no 500s
- [ ] **Outage drill:** point `NEON_AUTH_BASE_URL` at an unreachable host → sign-in
      reports an outage, **not** "wrong password"

---

## 7. The FastAPI backend

`backend/` is a separate service with its own environment and deploy. **It has
been migrated in this change** — it now verifies Neon Auth JWTs and reads
authorization from Postgres. It must still be *deployed* before or alongside the
Next.js app, because a backend expecting Supabase tokens and an app issuing Neon
tokens cannot talk to each other.

> **Correction to an earlier revision of this section.** It said to point JWKS at
> `{NEON_AUTH_BASE_URL}/jwt`. That endpoint does not exist. The JWKS document is
> served at `{NEON_AUTH_BASE_URL}/.well-known/jwks.json`, and `iss` is the
> service **origin** — the base URL with its path dropped. Verified against
> Neon's own backend-verification guide and a decoded production token, not
> inferred. Both values are now derived from `NEON_AUTH_BASE_URL` in
> `backend/app/core/config.py` so they cannot be transposed by hand, and
> `tests/test_neon_auth.py` pins the difference as a test.

### What changed

| Concern | Before | After |
|---|---|---|
| Signing keys | `SUPABASE_JWT_SECRET` (HS256) or `SUPABASE_JWKS_URL` | JWKS only, at `{NEON_AUTH_BASE_URL}/.well-known/jwks.json`. There is no shared secret to configure, so the backend holds no credential that could mint a token. |
| Expected `iss` | `{SUPABASE_URL}/auth/v1` | Origin of `NEON_AUTH_BASE_URL` (path dropped) |
| Algorithms | `HS256` by default | `RS256,ES256`, pinned from configuration. An HMAC entry is **refused at startup** — accepting one from a JWKS provider is the algorithm-confusion attack. |
| `sub` | Treated as `users.id` | The **provider's** id. Resolved through `users.auth_user_id` to reach `users.id` (`app/core/identity.py`). |
| Application role | `app_metadata.role` claim | `users.role`, read from Postgres per request |
| Onboarding / seller | `app_metadata` claims | `profiles.onboarded`; existence of a `sellers` row |
| Bans | Unenforceable (stateless) | `users.is_banned` / `is_active`, effective on the next request |
| `cryptography` | Optional `jwks` extra | Core dependency |

### Why the split is not optional

The second and third rows are the same rule seen twice: **the token
authenticates, the database authorizes.** Neon Auth issues no `app_metadata`, so
there is no claim to read a role from even in principle — and the `role` claim it
does carry is the string `"authenticated"`, a Postgres/RLS role that would make
every signed-in user identical if read as an application role.
`AuthContext.role` is populated from `users.role`, and a test asserts that a
token claiming `"role": "SUPER_ADMIN"` still produces a non-staff context.

Resolving identity costs one indexed lookup per authenticated request
(`users.auth_user_id` is unique). That is the price of an answer that cannot go
stale, and it is the same trade the Next.js guards make. If it ever needs
caching, cache it in Redis for seconds and invalidate on write — never in a
token, which outlives the permission it describes.

### Two failure modes deliberately separated

* **No mapping row** → `403`. The caller is authenticated and simply has no
  MaliHub account yet. Answering `401` would tell a client to discard a valid
  token and re-authenticate, which loops.
* **Database unreachable, or JWKS unreachable** → `503`. "Cannot answer" must
  never be reported as "you have no account": on the frontend, a cache that
  could lag the database produced the /dashboard ↔ /complete-profile loop this
  migration removes. Both cases fail closed, and both are tested.

### Rollback

`SupabaseJwtVerifier` and every `SUPABASE_*` setting are retained unmodified and
selected by `AUTH_PROVIDER=supabase-legacy`. Exactly one provider is ever
active: there is **no cross-provider fallback**, because a backend that accepted
both would honour a stale Supabase token for as long as it remained unexpired
after the cutover. A configured `SUPABASE_JWT_SECRET` does not rescue a
Neon-selected deployment — it reports `unconfigured` and fails closed instead.

### Deployment checklist

```
AUTH_PROVIDER=neon
NEON_AUTH_BASE_URL=<same branch base URL the Next.js app uses>
DATABASE_URL=<the same application database>   # now required for AUTHORIZATION
```

`DATABASE_URL` stops being optional once auth is involved: role, onboarding and
seller status come from Postgres, and a backend that cannot reach it answers 503
rather than guessing. Deploy the backend first, verify
`GET /api/v1/health` and one authenticated call, then release the frontend.

---

## 8. Cutover procedure

Ordered so that no step leaves the app in a state where users cannot sign in.

1. **Deploy the backend change (§7) first**, or in the same window. A Next.js app
   issuing Neon Auth tokens to a backend that still expects Supabase tokens means
   every API call fails verification.
2. **Apply the migration.** `prisma migrate deploy`. Additive and nullable — safe
   against the running app, which still reads nothing from the column.
3. **Set the environment variables** (§3). Do not enable linking yet.
4. **Deploy the application.**
5. **Run the verification checklist** (§6) against production.
6. **Only then** begin the user migration (§4): create Neon Auth accounts, notify
   customers, open the linking window.

Sessions do not survive the cutover. Supabase cookies and Neon Auth cookies are
unrelated, so **every user is signed out at deploy** and must sign in again — with
a new credential if they are a legacy user. That is unavoidable and worth saying in
the announcement rather than letting people discover it.

---

## 9. Rollback plan

Rollback is viable **as long as no `auth_user_id` mapping has been written**, and
degrades gracefully afterwards.

### Before any user is mapped

1. Revert the deploy to the previous commit (Supabase Auth).
2. Restore the two environment variables' *usage* — they are still in `.env.example`
   and the Supabase values were never removed.
3. Optionally drop the column (§2). Not required: an unused nullable column is
   harmless.

Nothing else is needed, because the rollback targets were preserved rather than
deleted:

| File | Role in rollback |
|---|---|
| `src/lib/supabase/auth-legacy.ts` | the complete retired implementation: identity mapping, provisioning keyed on `users.id`, `syncSupabaseAppMetadata`, `supabaseCompleteUserProfile`, `mapSupabaseError` |
| `src/lib/supabase/middleware.ts` | `updateSession()` — restore the call in `src/middleware.ts` |
| `src/lib/supabase/{client,server}.ts` | never removed; still in use for Storage/Realtime |
| `/api/auth/callback` | currently 410; restore from git history if OAuth/email links must work again |

Because application code depends on `@/lib/auth` rather than on a provider,
rollback does **not** require editing ~25 feature files. The seams are:

- `src/middleware.ts` → call `updateSession()` again
- `src/app/(auth)/actions.ts` → restore from git history (the Supabase version is
  one revert away)
- `src/lib/auth/session.ts` → `getAuthContext()` reads a Supabase user instead of a
  Neon session; the guards' signatures do not change, so no call site moves
- `src/services/account-provisioning.ts` → key on `users.id` instead of
  `auth_user_id` (this is what `auth-legacy.ts` preserves)

### After mappings exist

The Supabase accounts still exist — nothing in this migration deleted or altered
them — so rolling back restores sign-in for anyone who still has their old
credential. What is lost is the *link* between a Neon Auth identity created during
the window and the application row it claimed.

- Rows claimed from legacy accounts (`auth_user_id` filled, `users.id` unchanged)
  are **unaffected**: they were always MaliHub rows, and rollback simply ignores the
  mapping column.
- Accounts **created new** during the Neon Auth window have no Supabase credential.
  They need a password reset through Supabase, or a support-assisted one. Export
  the affected set first:
  ```sql
  SELECT id, email, created_at FROM users
  WHERE auth_user_id IS NOT NULL
    AND created_at >= '<cutover timestamp>';
  ```

**Keep `auth_user_id` populated even after a rollback.** Do not null it out. It is
the record of who signed in during the window, and it makes a second migration
attempt resumable instead of starting from scratch.

### When to delete the legacy code

Only once all of these are true: the cutover has been stable for a full release
cycle, the user migration is complete, no rollback has been exercised, and the
FastAPI backend no longer references `SUPABASE_JWT_SECRET`. Until then the retained
files cost nothing — they are not imported, not bundled (verify: the edge bundle is
75 kB), and not in any request path.

---

## 10. Supabase: what stays and why

| Capability | Status | Note |
|---|---|---|
| **Auth** | **removed from the request path** | code retained in `auth-legacy.ts` |
| Storage — profile avatars | **kept** | `src/components/auth/avatar-upload.tsx`; not authentication |
| Realtime — chat presence/typing | **kept** | `src/hooks/use-chat-realtime.ts`; unrelated to identity |
| Postgres as the app database | unchanged | §6c of the root architecture doc; Prisma owns the schema |
| `manual_rls_policies.sql`, `manual_storage_avatars.sql` | still apply | RLS is the backstop for anything reaching Postgres outside Prisma |
| `manual_auth_trigger.sql` | obsolete | it mirrored Supabase `auth.users` into `users`; only ever meaningful when the app database *was* Supabase Postgres |

The packages (`@supabase/supabase-js`, `@supabase/ssr`) stay installed and
importable. Removing them would break Storage and Realtime, which are not part of
this migration.

---

## 11. Known limitations and open items

| Item | Impact | Note |
|---|---|---|
| No custom Better Auth plugins | Cannot add app-specific claims or server-side handlers | This is *why* there is no claim cache. MaliHub does not need one. |
| Verification links need a custom email provider | On the shared provider only CODES work | `/verify-email` adapts automatically (§ARCHITECTURE 8) |
| Reset links expire after 15 minutes | A slow clicker sees "Link expired" | Handled: `/reset-password` renders a "request a new link" card for `?error=` or a missing token |
| Sessions do not survive the cutover | Everybody signs in again | Unavoidable; announce it (§8) |
| FastAPI backend not migrated | Its authenticated routes reject Neon tokens | §7 — must be done before or with the app deploy |
| `requireUser()` loses `redirectTo` when the session dies mid-render | Rare: the person lands on their default dashboard after re-signing-in | Deliberate — inventing a path from `referer` would be an open-redirect risk (§ARCHITECTURE 7) |
| Provider id format is opaque | None | Stored as `TEXT`, matched by equality, never parsed. The POC's "32-char non-UUID" finding was derived from its own mock and is not relied on anywhere. |
