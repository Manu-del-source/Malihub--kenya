# Neon Managed Better Auth — proof-of-concept report

**Question this report answers:** can Neon Managed Better Auth act as MaliHub
Kenya's identity provider instead of Supabase Auth?

**What this is:** an isolated, evidence-producing POC at `/neon-auth-test`. No
production auth code, Prisma schema, database URL, Supabase configuration, or
environment setting was changed. Nothing was pushed, merged, or deployed.
**No migration recommendation is made here** — only findings.

- What was verified **live in this environment**: the `@neondatabase/auth`
  Next.js SDK itself (proxy, cookie minting/validation, middleware, server
  session API) on Next.js 15.5.22, driven by a local mock of the Managed Better
  Auth REST service.
- What could **not** be verified here: the live Neon Auth service on the MaliHub
  production branch (this environment has no network route to
  `*.neonauth.*.neon.tech` and no Neon credentials). §L and §M say exactly what
  to run to close that gap.

---

## A. Exact Neon package/version installed

```
@neondatabase/auth@0.5.0-beta        (exact pin, not a range)
```

Installed with:

```bash
npm install --save-exact --legacy-peer-deps @neondatabase/auth@0.5.0-beta
```

- `--legacy-peer-deps` is **required**, not cosmetic: the package declares
  `peerDependencies.next: ">=16.0.0"` (optional peer) while this app is pinned to
  **Next.js 15.5.22**. Plain `npm install` fails with `ERESOLVE`. Every published
  version of `@neondatabase/auth` (`0.1.0-beta.10` … `0.5.0-beta`) declares a
  Next 16 range.
- Transitive additions: **212 packages**, including `better-auth@1.6.23`,
  `jose@6.2.5`, `zod@4.3.6`, `@neondatabase/auth-ui@0.3.0-beta` (nested), and
  `@supabase/auth-js@2.79.0` (nested, pulled in for the SDK's unused
  `SupabaseAuthAdapter` — **the POC never imports or uses it**).
- **Nothing was upgraded.** `npm ls` and a package-lock diff confirm zero version
  changes to: `next` 15.5.22, `react`/`react-dom` 19.0.0, `typescript` 5.7.3,
  `prisma`/`@prisma/client` 6.2.1, `@supabase/supabase-js` 2.47.10,
  `@supabase/ssr` 0.5.2.
- `@neondatabase/neon-js` was **not** installed: it is the client-side
  React/Vite SDK (and Data API client). The current official Next.js integration
  is `@neondatabase/auth` (`/next` and `/next/server` subpaths). The Neon Console
  Quickstart that suggests `@neondatabase/neon-js` targets the Vite/React path.

## B. Official Neon integration pattern used

Source of truth (official docs only, verified against the published package):

- Next.js quick start — <https://neon.com/docs/auth/quick-start/nextjs-api-only>
- Next.js server SDK reference — <https://neon.com/docs/auth/reference/nextjs-server>
- Trusted domains — <https://neon.com/docs/auth/guides/configure-domains>
- Legacy→Managed migration (why Stack Auth is wrong here) —
  <https://neon.com/docs/auth/migrate/from-legacy-auth>

Pattern implemented:

| Concern | SDK call | Where in this repo |
| --- | --- | --- |
| Server instance | `createNeonAuth({ baseUrl, cookies: { secret }, logLevel })` | `src/lib/neon-auth/server.ts` |
| API proxy | `auth.handler()` → `GET/POST/PUT/DELETE/PATCH` | `src/app/neon-auth-test/api/auth/[...path]/route.ts` |
| Route protection | `auth.middleware({ loginUrl })` | `src/lib/neon-auth/middleware.ts` (invoked from `src/middleware.ts`) |
| Server session | `auth.getSession()` | POC pages (`/neon-auth-test`, `/protected`) |
| Server auth actions | `auth.signUp.email()`, `auth.signIn.email()`, `auth.signOut()` | `src/app/neon-auth-test/actions.ts` |
| Client session | `createAuthClient()` from `@neondatabase/auth/next` | **not used** (see §M: it assumes `/api/auth` is the proxy mount, which MaliHub already owns) |

Environment variables (both **server-side only** — no `NEXT_PUBLIC_*`):

```
NEON_AUTH_BASE_URL   # documented name; NEON_AUTH_URL is accepted as an alias
NEON_AUTH_COOKIE_SECRET   # 32+ chars, HMAC-SHA256 key for the session-data cookie
NEON_AUTH_POC_ENABLED     # only required to un-dark the POC when NODE_ENV=production
```

Mount point: the documented mount is `app/api/auth/[...path]/route.ts`, but
MaliHub already owns `/api/auth/callback` for Supabase. The POC therefore mounts
its own copy under `/neon-auth-test/api/auth/[...path]` and the root middleware
never applies auth checks to it. **Coexistence was verified in a production
build**: both `/api/auth/callback` (Supabase) and
`/neon-auth-test/api/auth/[...path]` are emitted as separate routes.

## C. Files added / modified

**Added — server seam (3)**

| File | Purpose |
| --- | --- |
| `src/lib/neon-auth/config.ts` | Env resolution, POC enablement guard, path ownership. Dependency-free so middleware can import it cheaply. |
| `src/lib/neon-auth/server.ts` | Lazy, memoized `createNeonAuth()` instance (`server-only`). |
| `src/lib/neon-auth/middleware.ts` | Lazy `auth.middleware({ loginUrl })` factory. |

**Added — POC routes (11)**

- `src/app/neon-auth-test/layout.tsx` (POC banner, `noindex`)
- `src/app/neon-auth-test/page.tsx` (overview: session state, identity probe, sign-out)
- `src/app/neon-auth-test/sign-in/page.tsx` (the middleware's `loginUrl` target)
- `src/app/neon-auth-test/protected/page.tsx` (protected test page + middleware evidence)
- `src/app/neon-auth-test/actions.ts` (server actions: sign-up / sign-in / sign-out)
- `src/app/neon-auth-test/poc-state.ts` (form state; `"use server"` files may only export async functions)
- `src/app/neon-auth-test/poc-forms.tsx` (minimal `useActionState` forms)
- `src/app/neon-auth-test/session-view.ts` (defensive session → view-model mapper)
- `src/app/neon-auth-test/session-panels.tsx` (session display + read-only Prisma identity probe)
- `src/app/neon-auth-test/not-configured.tsx` (inert state)
- `src/app/neon-auth-test/api/auth/[...path]/route.ts` (SDK proxy)

**Added — tests (5 files)**

- `src/lib/neon-auth/__tests__/mock-auth-upstream.ts` (local stand-in for the
  Managed Better Auth REST service)
- `src/lib/neon-auth/__tests__/neon-auth-flow.test.ts` (sign-up/sign-in/session/
  middleware/sign-out/failure handling, real SDK)
- `src/app/neon-auth-test/__tests__/poc-guard.test.ts` (enablement + payload mapping)
- `src/app/neon-auth-test/__tests__/poc-middleware.test.ts` (root middleware composition)
- `src/app/neon-auth-test/__tests__/poc-isolation.test.ts` (guard-rails: no Supabase,
  no provisioning, no Prisma writes, no schema/migration change)

**Added — docs (2)** — `docs/neon-auth-poc/AUDIT.md`, this file.

**Modified (3, all additive)**

- `src/middleware.ts` — a POC branch that returns **before** `updateSession()`, so
  POC requests never touch Supabase and production requests never touch Neon Auth.
- `package.json` / `package-lock.json` — the single new dependency.
- `.env.example` — commented POC variables (no secrets).

Not touched: `prisma/**`, `DATABASE_URL`/`DIRECT_URL` usage, `src/lib/supabase/*`,
`src/app/(auth)/**`, `src/app/api/auth/callback/route.ts`,
`src/services/auth-service.ts`, `src/services/account-provisioning.ts`,
Supabase/Vercel configuration.

## D. How Neon Auth session persistence works

Verified by reading the published SDK and by the POC tests:

1. **`__Secure-neon-auth.session_token`** — the real session cookie, issued by the
   Managed Better Auth service and proxied through `auth.handler()` to the browser
   (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
2. **`__Secure-neon-auth.local.session_data`** — a **HS256 JWS signed with
   `NEON_AUTH_COOKIE_SECRET`**, containing `{ session, user }`, TTL **300 s**
   (configurable via `cookies.sessionDataTtl`). The SDK mints it (a) whenever the
   upstream response rotates the session token and (b) reactively on a cache miss,
   after calling upstream `GET /get-session` with the session token.
3. Server-side reads (Server Components, Server Actions, middleware) validate the
   JWS **locally with `jose`** — no network call. Measured in the POC tests: a
   `get-session` request carrying both cookies is served from the cache with
   **0 upstream calls**; the same holds for middleware on a protected route.
4. The role is **not** in a JWT claim the way Supabase's `app_metadata` is; the
   session payload is a signed snapshot of the upstream session/user object.
5. Sign-out: the proxy returns upstream's session-token deletion **and** the SDK
   deletes `session_data` (`Max-Age=0` on both). A browser then sends no session
   cookie and the protected route is blocked again (tested).

## E. How middleware can authenticate a request

`auth.middleware({ loginUrl })` (Next 15: `middleware.ts`; Next 16 renames the
file to `proxy.ts`, per the docs) — used exactly as documented, but scoped:

- validates the session cookie locally (signed `session_data` first, upstream
  `GET /get-session` as fallback), refreshes/mints the cookie cache when needed;
- **redirects unauthenticated requests to `loginUrl`** (307) preserving the path;
- **allows** requests with a session and stamps `x-neon-auth-middleware: true` on
  the request it lets through (the protected POC page displays this as evidence);
- treats a `session_data` cookie without a `session_token` as stale, clears it and
  redirects;
- fails **closed**: with an unreachable auth server the request is redirected to
  sign-in rather than allowed.

Default skip routes inside the SDK are `/api/auth`, `/auth/callback`,
`/auth/sign-in`, `/auth/sign-up`, `/auth/magic-link`, `/auth/email-otp`,
`/auth/forgot-password`, plus the configured login URL. Because the POC's proxy
lives under `/neon-auth-test/api/auth` (not `/api/auth`), `src/middleware.ts`
explicitly keeps that path away from auth checks.

## F. How the authenticated Neon user id is obtained

- Server Components/Actions/Route Handlers: `auth.getSession()` →
  `{ data: { session, user }, error }`; `data.user.id`, `data.user.email`,
  `data.user.emailVerified`, `data.session.id`, `data.session.expiresAt`
  (`expiresAt`/`createdAt` arrive as real `Date` objects — asserted in tests).
- Middleware: the session is validated but only its presence is used for
  route protection (the SDK's decision object is framework-converted internally).
- **ID format (important):** ids are **Better Auth ids — 32-character
  alphanumeric random strings, not UUIDs**. Every id observed in the POC
  (user and session ids) matched `^[A-Za-z0-9_-]{32}$`, and the SDK's own
  `session_data` JWS uses that id as the `sub` claim. `prisma/schema.prisma`
  types `User.id` as `String @id @db.Uuid`, so the Neon identity **cannot be
  written into `users.id` as-is** — see §N.
- The POC's landing page performs a **read-only** probe of the Prisma `users`
  table for the Neon user id and reports the outcome; it never writes (enforced
  by `poc-isolation.test.ts`).

## G–K. Flow results

Each row states where the evidence comes from. "Mock-upstream" means the real
`@neondatabase/auth` code exercised against a local HTTP service that implements
the Better Auth endpoints the SDK calls — necessary because the production Neon
branch is not reachable from this environment, and tests must never point at it.

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| G | Does email/password **sign-up** work? | ✅ 200, account created, **both** session cookies issued (`session_token` + minted `session_data` JWS); duplicate sign-up surfaces the upstream error (`422 User already exists`); invalid input is rejected by the upstream | mock-upstream test, `neon-auth-flow.test.ts` |
| H | Does **login** work? | ✅ 200 + session cookie for correct credentials; **401 with no session cookie** for a wrong password | mock-upstream test |
| I | Does **logout** work? | ✅ upstream `POST /sign-out` called once; `session_token` **and** `session_data` deleted with `Max-Age=0`; with the browser's cookie jar emptied the protected route returns 307 to sign-in again | mock-upstream test |
| J | Does **session persistence / refresh** work? | ✅ a second, independently created `createNeonAuth` instance serves `get-session` from the signed cookie with **0 upstream calls**; on cache miss/expiry the SDK re-fetches upstream using the session token and re-mints; `getSession()` returns `expiresAt` as a `Date` | mock-upstream tests + SDK source |
| K | Does the **protected route** work? | ✅ unauthenticated → 307 to `/neon-auth-test/sign-in`; authenticated → served, with `x-neon-auth-middleware: true` stamped by the SDK; `session_data` without `session_token` → 307; upstream unreachable → 307 (**fail closed**); the page additionally re-checks the session server-side. Root-middleware composition verified against the real function: `/dashboard/*` still redirects to `/login?redirectTo=…`, public/auth routes unchanged, and no POC request reaches Supabase | mock-upstream tests, `poc-middleware.test.ts`, `src/middleware.ts` |

**Verification commands run in this repository**

| Command | Result |
| --- | --- |
| `npm test` | **71 tests / 16 suites / 71 pass / 0 fail** (baseline before the POC: 32 tests / 7 suites, all passing) |
| `npm run type-check` | clean |
| `npm run lint` | clean |
| `npx prisma validate` | ⚠️ **blocked by this sandbox**, not by the POC: Prisma downloads its schema/query engines from `binaries.prisma.sh`, which is unreachable here. `prisma/schema.prisma` is byte-identical to `main` (guard test asserts: no Neon/BetterAuth models, no new migration folder). |
| `npm run build` | ✅ **succeeded** with two sandbox-only env workarounds — `PRISMA_*_ENGINE_*` pointing at a placeholder engine (network-blocked engine download) and `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` (network-blocked `fonts.googleapis.com`). All routes built, including `/api/auth/callback` and the four POC routes; middleware 107 kB vs **65.2 kB** without the POC. |

## L. Production trusted-domain configuration

**Not verifiable from this environment** — no network route to the Neon Auth
hosts and no credentials, so the POC was never pointed at the production branch.
What the official docs say, and what to run to confirm it:

- Trusted domains gate **redirect targets** (OAuth returns, verification and
  reset links). A redirect to a domain that is not on the allowlist is blocked;
  entries must include the protocol and no trailing slash.
  `https://malihub.smartbiz365.site` was **not modified** by this work.
- `http://localhost:3000`, `http://localhost:5173` and **any localhost port** are
  pre-configured, so local development does not require touching the production
  domain list (matching the "Allow Localhost" setting described in the Console).

To close this item in your own environment (nothing below was executed here):

```bash
# .env.local — never committed, server-side only
NEON_AUTH_BASE_URL=https://<auth-host-from-console>/<db>/auth
NEON_AUTH_COOKIE_SECRET="$(openssl rand -base64 32)"
# NEON_AUTH_POC_ENABLED=true   # only needed when NODE_ENV=production
npm run dev
# 1. open http://localhost:3000/neon-auth-test
# 2. sign up with a dedicated test account (do NOT reuse a production user)
# 3. reload  → session persists (check both __Secure-neon-auth cookies)
# 4. /neon-auth-test/protected → allowed; sign out → redirected again
# 5. Neon Console → Auth → Users: confirm the new user exists
```

For the production domain, deploy a **preview** with the same two variables plus
`NEON_AUTH_POC_ENABLED=true`, walk the same five steps on
`https://malihub.smartbiz365.site`, and confirm that any e-mail/OAuth link the
service issues returns to that origin. Until then, the trusted-domain behaviour
is **documented, not verified**.

## M. Limitations discovered

1. **Next.js peer range vs. this app.** `@neondatabase/auth@0.5.0-beta` declares
   `next >= 16`; MaliHub runs Next 15.5.22. The SDK nonetheless **worked** here —
   tests, a production build, and middleware all passed on 15.5.22 — but it is
   installed against its declared peer range (`--legacy-peer-deps`), which will
   make every future `npm install` awkward until either Next is upgraded or the
   SDK widens the range. The docs' Next-16 note (`proxy.ts` replaces
   `middleware.ts`, identical logic) is the only documented difference.
2. **Revocation is eventually consistent.** The signed `session_data` cookie is a
   5-minute cache; middleware trusts it without contacting Neon. A client that
   keeps sending cookies that sign-out asked it to delete still passes route
   protection until the cache expires (browsers delete them, so this needs a
   copied cookie jar or a client that ignores `Max-Age=0`). `GET /get-session?
   disableCookieCache=true` sees the revocation immediately. Captured as an
   explicit test, not a guess.
3. **No `app_metadata` equivalent.** MaliHub's edge authorization reads
   `role`, `has_seller_profile` and `onboarded` from Supabase's `app_metadata`
   claim. Managed Better Auth exposes user/session data, not arbitrary
   authorization claims (Neon Auth does not accept custom Better Auth plugins or
   server-side handlers). Any migration must move those five middleware checks to
   a server-side source (Neon read or an own signed claim).
4. **User-id format.** Better Auth ids are 32-char text, not UUIDs
   (`User.id @db.Uuid` today) — see §N.
5. **Middleware bundle cost.** Even though the SDK is imported lazily behind the
   POC branch, Next bundles it for middleware: **107 kB vs 65.2 kB** without the
   POC (+41.8 kB, `better-auth` helpers + `jose`). Production routes do not
   execute it, but every request carries the code.
6. **Dependency footprint.** 212 new packages, including
   `@neondatabase/auth-ui@0.3.0-beta` and the unused `@supabase/auth-js@2.79.0`
   (nested, for the SDK's Supabase-compatibility adapter).
7. **Client SDK needs `/api/auth`.** `createAuthClient()` from
   `@neondatabase/auth/next` takes no URL and assumes the proxy is mounted at
   `/api/auth`. MaliHub already serves `/api/auth/callback` (Supabase), so the
   POC uses **server-side** SDK calls only. A migration would have to move the
   Supabase callback or accept the SDK's default mount.
8. **`__Secure-` cookie prefix.** Both cookies use the `__Secure-` prefix, which
   requires HTTPS in browsers outside localhost; the Neon docs recommend
   `npm run dev -- --experimental-https` if a browser refuses them.
9. **Not exercised by this POC** (out of scope, needs the live service): e-mail
   verification delivery, password reset, Google OAuth, organisation/OTP plugins,
   webhooks, and the SDK's `useSession()` React hook.

## N. Conflict with MaliHub's current Prisma user/profile model

| Aspect | Today (Supabase) | Neon/Better Auth | Conflict |
| --- | --- | --- | --- |
| `User.id` | Supabase auth UUID, matches `@db.Uuid` | 32-char text id | **Yes** — cannot be inserted into `users.id`; needs a mapping column, a text migration, or an id-generator change |
| `User.email` (unique, non-null) | from Supabase | `user.email` | No |
| `User.emailVerified` | `email_confirmed_at` | `user.emailVerified` | No (semantics differ slightly: verification is a flag, not a timestamp) |
| `User.phone` | `user.phone` | no phone on the POC account | POC collects phone at `/complete-profile`, not at sign-up — unchanged |
| `Profile.fullName` / `avatarUrl` | `user_metadata.full_name`/`name`, `avatar_url` | `user.name`, `user.image` | Field mapping differs; the mapper is a one-line change |
| `Seller` row | created by provisioning on SELLER intent | same | No |
| Foreign keys / relations | none added | none added | The POC created **no** FK, no model, no migration (asserted by a test) |

Nothing in the POC writes to `users`/`profiles`/`sellers`; the Neon Auth test
identity is completely separate from MaliHub's production user, as required.

## O. What would have to change to migrate MaliHub off Supabase Auth

Ordered, smallest-first. None of this was done — it is the scope a decision would
commit to.

1. **Identity key strategy** (blocks everything else). Keep `users.id` as the
   UUID primary key and add a unique, nullable `authProvider`/`authUserId` text
   pair (or a dedicated `identities` table), so a Neon id can be linked without a
   destructive change; backfill existing users by email during cutover. A direct
   `id → text` migration touches every FK in the schema and is the expensive path.
2. **Authorization claims** (blocked by §M.3). Decide how `onboarded`, `role`,
   `has_seller_profile` reach the edge: either read Neon in middleware (a DB
   round-trip per request, or a cached read) or mint an own signed cookie/claim.
   The five checks in `src/middleware.ts` must be re-pointed; the logic itself can
   stay identical.
3. **Middleware session source.** Swap `updateSession()` (Supabase) for
   `auth.middleware()` (Neon) with a custom `loginUrl`, keeping the POC's
   isolation trick temporary: the SDK's default skip routes (`/api/auth`, …) do
   not match MaliHub's production auth paths (`/login`, `/register`, `/dashboard`).
4. **Auth actions and callback route.** Rewrite `src/app/(auth)/actions.ts`
   (sign-up, sign-in, Google OAuth, resend, forgot/reset password) on
   `auth.signUp.email` / `signIn.email` / `signIn.social` /
   `sendVerificationEmail` / password-reset APIs; replace
   `src/app/api/auth/callback/route.ts` code exchange with the SDK's proxy
   (`/api/auth/[...path]`), which means moving the Supabase callback path during
   the dual-run window; re-implement `mapSupabaseError` against Better Auth error
   shapes.
5. **Re-enable provisioning.** `ensureUserProvisioned` already takes a structural
   `AuthIdentity`; build it from the Better Auth session (`user.name`/`user.image`
   instead of `user_metadata`) and keep `/complete-profile` as the authoritative
   onboarding write. `syncSupabaseAppMetadata` is deleted, not ported.
6. **Session/role freshness.** Replace "admin API + `refreshSession()`" with the
   new claim mechanism from step 2, and decide the `sessionDataTtl` (300 s today)
   against how quickly a role change must take effect.
7. **Deployment configuration.** Add `NEON_AUTH_BASE_URL` and
   `NEON_AUTH_COOKIE_SECRET` to the hosting environment (Vercel previews and
   production), confirm the trusted-domain list covers the production and preview
   origins, and remove `NEON_AUTH_POC_ENABLED`-style gating only at cutover.
   No `NEXT_PUBLIC_*` variable is needed.
8. **Credentials migration.** Supabase password hashes are not reusable by Better
   Auth: every user must set a new password (forced reset) or be migrated through
   a verified reset flow. Plan a dual-run period (both providers live, one
   authoritative) rather than a hard cut.
9. **Cleanup after cutover.** Remove `@supabase/ssr`, `@supabase/supabase-js`,
   `SUPABASE_*` variables, `src/lib/supabase/*`, and the Supabase-only manual SQL
   (RLS helpers/trigger/storage notes) that the Prisma data path never used; the
   FastAPI backend's Supabase JWT verification (`SUPABASE_JWT_SECRET`/JWKS) must
   be re-pointed at the new token issuer.
10. **Testing.** Port the Supabase-claim tests (`middleware.test.ts`,
    `sign-in-action.test.ts`, `complete-profile-action.test.ts`) to the new claim
    source, and keep an equivalent of this POC's mock-upstream harness for
    provider-outage and revocation cases.

## Reproduce the POC verification

```bash
npm test           # 71 tests / 16 suites, includes the Neon Auth flow coverage
npm run type-check
npm run lint
git diff --stat -- prisma   # expected: empty (no schema/migration changes)
```

In a networked environment, the remaining commands are simply:

```bash
npx prisma validate
npm run build
```

In this sandbox those two need the documented workarounds (offline Prisma engine
and offline Google Fonts) described in §G–K; they are environment constraints, not
findings about Neon Auth.
