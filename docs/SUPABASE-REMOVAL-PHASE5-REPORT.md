# Supabase removal — Phase 5 acceptance report

**Date:** 2026-10-12 · **Branch:** `arena/174af3cf-malihub-kenya` · **Phase 4 commit
under review:** `b6e3d5e2aefc2a0b5e69422a2332fc128a0488d6` (**PR #36**, base `main`,
open, mergeable) · **Phase:** 5 of
[`SUPABASE-REMOVAL-PLAN.md`](./SUPABASE-REMOVAL-PLAN.md) — full acceptance testing
and sign-off before merge.

**How to read this document.** Everything in §3–§5, §7 and the appendix marked
**PASS** was executed in this sandbox and its literal result is recorded. Items
that need production credentials, a live deployment or operator confirmation are
marked **BLOCKED** or **NOT RUN** and are never described as verified. No secret
values, session tokens or user data appear in this report; environment variables
are listed by name only.

---

## 1. Executive summary and release decision

Phase 5 re-verified the whole removal end to end and found **four defects**, all
fixed in this phase's commit (details in §2):

1. **Tracked generated build cache.** `tsconfig.tsbuildinfo` was committed, and
   the Phase 4 commit rewrote it with a machine-dependent cache (1,810 entries
   including 1,437 `node_modules` and 69 `.next` paths, versus 861 before) — a
   diff that describes the reviewer's machine, not the code. It is now untracked
   and ignored.
2. **Reconnect cap unreachable** (functional, client). `ChatSocketManager`
   reset its retry counter inside `ensureConnected()`, which the retry timer
   itself calls — so `MAX_RECONNECT_ATTEMPTS` never fired and a permanently
   failing realtime endpoint was retried forever, contradicting the module's own
   documented contract. Fixed; regression tests added.
3. **Truncated comment** in the security-sensitive participant check
   (`backend/app/services/chat_realtime.py`), which had lost its opening clause.
4. **Inaccurate env documentation**: `.env.example` described
   `NEXT_PUBLIC_API_BASE_URL` as the variable the app needs to reach the backend;
   no code in `src/` reads it. Corrected rather than removed.

All automated gates pass on the final tree: TypeScript 0 errors, ESLint 0,
frontend tests **722/722**, production build 0, backend pytest **497 passed**,
Ruff 0, backend `pip-audit` clean, and `npm audit` unchanged at 10 advisories
(0 critical, all transitive build tooling). The repository's own gate runner
reports `GATES: all hard gates passed (8 gates run)`.

The one Supabase-related **functional** path that remains is deliberate: legacy
avatar URLs. Its removal still depends on a production migration that has **not**
been run, and deployed WebSocket/Redis acceptance still depends on infrastructure
this sandbox cannot reach.

### Decision

> ## `CONDITIONAL GO — code verified, production checks outstanding`

Merge is appropriate **after** the outstanding items in §8 are scheduled and the
operator confirms the deployment shape in §6. Nothing found in this phase
requires a code change before merge; the blockers are production verification,
not defects.

---

## 2. Repository / PR audit and files changed

### 2.1 What was inspected

`docs/SUPABASE-REMOVAL-PLAN.md`, `docs/SUPABASE-REMOVAL-PHASE4-REPORT.md`,
`docs/auth/MIGRATION.md`, the complete Phase 4 diff (`git show b6e3d5e`), and
every Phase 2–4 artefact: the chat realtime stack (frontend route/hook/client/
services and the backend endpoint/hub), the avatar stack (route, component,
Cloudinary client, validators, migration script), authentication and
configuration (`src/lib/auth/**`, `src/middleware.ts`, `src/lib/supabase/**`,
`backend/app/core/{config,security,redis}.py`), both `.env.example` files, and
`package.json`/`package-lock.json`.

### 2.2 Defects found and fixed

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **Generated file committed and rewritten.** `tsconfig.tsbuildinfo` was tracked (not ignored) although `tsconfig.json` sets `incremental: true`; the Phase 4 commit's one-line diff replaced 861 cache entries with 1,810, including absolute-ish `node_modules`/`.next` paths — and the old cache still referenced three components that no longer exist (`src/components/auth/resend-verification-button.tsx`, `src/components/dashboard/seller/{listing-status-badge,listing-row-actions}.tsx`, all deleted before Phase 4). | `git ls-files tsconfig.tsbuildinfo`; JSON diff of `b6e3d5e^` vs `b6e3d5e` | `git rm --cached tsconfig.tsbuildinfo` + `.gitignore` entries (`tsconfig.tsbuildinfo`, `*.tsbuildinfo`) with the rationale. Cost of removal: one full type-check on the next run; nothing imports it. |
| 2 | **Reconnect cap never reached.** `ensureConnected()` reset `this.reconnectAttempts = 0` on every call, and the reconnect timer calls exactly that method — so the documented "gives up after a bounded number of attempts" was dead code and a permanently failing endpoint retried indefinitely (every 30 s, each retry fetching a fresh ticket). | New test "gives up after the attempt cap instead of retrying forever" failed against the old code (22+ sockets, unbounded) | Counter is now reset only in `subscribe()` — "fresh user interest re-arms it", exactly as the module documents. No other call site changed. |
| 3 | **Truncated comment** in `backend/app/services/chat_realtime.py` (participant-check error path): the sentence explaining *why* only the exception type is logged had lost its opening clause. | Reading the file | Comment restored ("Log the exception TYPE only, never its text: driver errors can embed the DSN and the bound user id."). Comment-only change. |
| 4 | **Inaccurate env description.** `.env.example` said `NEXT_PUBLIC_API_BASE_URL` is "the only variable the Next.js app needs in order to reach" the backend. No file in `src/` reads it. | `grep -rn "NEXT_PUBLIC_API_BASE_URL" src/` → no reader | Comment now states it is currently unread by `src/` (buyer payments run in Next.js; realtime uses `NEXT_PUBLIC_CHAT_WS_BASE_URL`) and is kept as the documented Phase 8 entry point. Variable retained — removing it is a deployment change, not a code fix. |

Checks that came back **clean** (no change needed): no stale imports of the
deleted `src/lib/supabase/client.ts` or `src/hooks/use-chat-realtime.ts`
(only explanatory comments remain); `@supabase/supabase-js` and
`socket.io-client` absent from the installed tree (`npm ls <pkg>` → empty);
`npm ls --all --depth=0` exits 0; the lockfile matches `package.json`; the
documented rollback step is real (`npm view @supabase/supabase-js@2.117.3` →
`2.117.3`, published) and is *necessary* (`@supabase/ssr` declares
`@supabase/supabase-js: ^2.43.4` as a peer while `.npmrc` sets
`legacy-peer-deps=true`, so npm will not reinstall it automatically); no
mid-flight Supabase network call or auth path exists in the request path (see
§7); the CSP `connect-src` no longer lists any Supabase origin while
`img-src`/`images.remotePatterns` still allow `*.supabase.co` for legacy
avatars only.

### 2.3 Files changed by Phase 5

| File | Change |
|---|---|
| `.gitignore` | + generated-cache patterns with rationale |
| `tsconfig.tsbuildinfo` | untracked (`git rm --cached`); file itself left on disk |
| `src/lib/chat/ws-client.ts` | defect 2 fix (counter reset moved to `subscribe()`) |
| `src/lib/chat/__tests__/ws-client.test.ts` | +4 regression tests (reconnect + re-join, cap + re-arm, heartbeat/pong timeout, ticket-endpoint failure) + teardown helper |
| `backend/app/services/chat_realtime.py` | defect 3 (comment) |
| `backend/tests/test_chat_realtime_security.py` | **new** — 8 security tests (§4) |
| `src/services/__tests__/chat-service-realtime.test.ts` | **new** — 9 ordering/contract tests (§4) |
| `.env.example` | defect 4 (comment) |
| `docs/SUPABASE-REMOVAL-PHASE5-REPORT.md` | this report |

No production code path, dependency, schema or migration was modified. Nothing
in PR #36 was merged, no branch other than `arena/174af3cf-malihub-kenya` was
touched, and no production configuration was changed.

### 2.4 Supabase reference classification (summary; full inventory in §7)

Of the 72 files that still contain the string `supabase`, **none is an active
runtime dependency**: 3 files are the inert Neon Auth rollback pair plus its
generated types, ~12 are legacy-avatar compatibility, 9 are historical SQL/schema
record, ~20 are prose in docs and comments, 5 are `.audit/` history, 2 are
`.env.example` templates, and the rest are tests/tooling that pin the above
(plus one gitignored artefact and one generated cache). §7 lists every one with
its removal trigger.

---

## 3. Automated verification results

All commands below were run in this sandbox on the final tree of this phase.
Exit codes are literal process exit codes.

| Gate | Command | Exit | Result | Phase 4 baseline |
|---|---|---|---|---|
| Frontend type-check | `npx tsc --noEmit` | **0** | 0 errors | 0 errors |
| Frontend lint | `npm run lint` | **0** | no findings | pass |
| Frontend tests | `npm test` | **0** | `# tests 722 / # suites 177 / # pass 722 / # fail 0` | 709 passed / 0 failed |
| Production build | `npm run build` | **0** | route table rendered; `ƒ Middleware 75 kB`; `/api/chat/ws-ticket` and `/api/avatar/upload` present | pass (75 kB) |
| Backend tests | `cd backend && .venv/bin/python -m pytest -q` | **0** | `497 passed in 3.89s` | 489 passed |
| Backend lint | `… -m ruff check app tests` | **0** | `All checks passed!` | pass |
| Backend dependency audit | `.venv/bin/pip-audit -r requirements.lock.txt` | **0** | `No known vulnerabilities found` | pass |
| Dependency audit (npm) | `npm audit` | **1** | `10 vulnerabilities (2 moderate, 8 high)` — **0 critical** | 10 advisories (identical) |
| Consolidated runner | `node scripts/audit-gates.mjs` | **0** | `GATES: all hard gates passed (8 gates run)` | same |

Literal consolidated output:

```
[pass] nextjs-typecheck (exit 0)
[pass] nextjs-lint (exit 0)
[pass] nextjs-tests (exit 0)
[pass] nextjs-build (exit 0)
[reviewed] nextjs-npm-audit (exit 1)
[pass] backend-pytest (exit 0) — 497 passed in 3.37s
[pass] backend-ruff (exit 0) — All checks passed!
[pass] backend-pip-audit (exit 0) — No known vulnerabilities found

GATES: all hard gates passed (8 gates run).
```

**Baseline comparison.** Every gate that passed in Phase 4 still passes; the
counts rise by exactly the tests added in this phase (frontend 709 → 722 = +9
chat-service + 4 ws-client; backend 489 → 497 = +8 security tests). No test was
removed, skipped or weakened.

**npm advisories (new vs pre-existing).** The advisory *count and set* are
unchanged from the Phase 4 baseline — `brace-expansion` (via
`glob`/`editorconfig`/`fast-glob`/`micromatch`/`chokidar`),
`postcss-selector-parser`/`postcss-nested`, and the
`@next/eslint-plugin-next`/`eslint-config-next` chain. All are **transitive
build/test tooling**; no advisory package is a direct dependency, none is loaded
at runtime, and this phase added no dependencies, so no new advisory can be
attributed to it. The runner deliberately scores this gate `reviewed`
(ASA-DEPS-001 in `.audit/validation-report.json`).

**Warnings observed (not failures).** `npm install` prints deprecation notices
for `@react-email/*`, `crypto-js`, `glob@10` and `eslint@9` — pre-existing and
unrelated to Phases 2–5. `ruff format --check` reports 8 files that "would be
reformatted" — `app/api/v1/endpoints/chat.py`, `app/core/config.py`,
`app/core/identity.py`, `app/services/chat_realtime.py`,
`tests/test_chat_realtime.py`, `tests/test_config.py`, `tests/test_identity.py`,
`tests/test_neon_auth.py`. All eight are **pre-existing drift** (the same eight
before Phase 5; the new security test file was formatted, keeping the count at
8). The repository's gate is `ruff check`, which passes, and reformatting
untouched modules would add unrelated churn to this PR.

**Evidence beyond exit codes** (both re-run on this phase's build output):

- `grep -ril supabase .next/server/middleware.js .next/server/edge-chunks` →
  no matches: the rollback set is not in the auth path.
- Every `supabase` match in `.next/static/**` is the legacy-avatar validator
  reading `NEXT_PUBLIC_SUPABASE_URL` — no Supabase SDK code, no Supabase origin.
- `grep -rl CHAT_WS_BASE_URL .next/static` → no matches (the WS base is read
  only in the server-side ticket route).

---

## 4. Chat realtime security and reliability acceptance

Traced through `src/app/api/chat/ws-ticket/route.ts`, `src/lib/chat/protocol.ts`,
`src/lib/chat/ws-client.ts`, `src/hooks/use-chat-socket.ts`,
`src/services/chat-realtime-events.ts`, `src/services/chat-service.ts`,
`backend/app/api/v1/endpoints/chat.py`,
`backend/app/services/chat_realtime.py`, plus backend config, `deps.py`,
`core/redis.py` and the lifespan wiring in `app/main.py`.

### 4.1 Ticket security

| Requirement | Verified behaviour | Evidence | Status |
|---|---|---|---|
| Issuance requires an authenticated session | `getCurrentUser()` before anything else; no session → 401; session without a MaliHub row → 401 | `ws-ticket-route.test.ts` "rejects an unauthenticated request (401)", "…no MaliHub row (401)" | PASS (automated) |
| Rate-limited | `rateLimit.chatWsTicket` = 20/min/user; 429 + `Retry-After` | `ws-ticket-route.test.ts` "answers 429 with Retry-After when rate-limited"; `src/lib/rate-limit.ts:81` | PASS (automated) |
| Short TTL | `SET … EX 60` — asserted on the stored key | `ws-ticket-route.test.ts` "stores the ticket under the shared key with a 60s TTL" | PASS (automated) |
| Single-use | Backend consumes with `GETDEL`; a second connect with the same ticket is closed 4401 | `test_ws_rejects_missing_and_spent_tickets` | PASS (automated) |
| Identity resolved server-side | Ticket → user id in Redis; frames carry no identity field at all | `consume_ticket()`; `test_frame_cannot_assert_another_identity` (new) | PASS (automated) |
| Cannot impersonate another user | A `join` frame carrying `userId`/`senderId` of the other participant is ignored: the denial and the presence announcement both use the ticket's user | **new** `test_frame_cannot_assert_another_identity` | PASS (automated) |
| Cannot authorize arbitrary rooms | A ticket grants a socket, never a room; every `join` re-checks the DB | `test_ws_hello_then_join_requires_participation`, `test_denial_is_indistinguishable_from_a_missing_chat` (new) | PASS (automated) |
| Used / expired / malformed / unknown tickets fail safely | Malformed shape → 4401 with no oracle; missing/spent → 4401; Redis failure → 4401 (fail-closed) | `test_ws_rejects_missing_and_spent_tickets`, `test_origin_header_grants_nothing`, `consume_ticket()` returning `None` on every failure path | PASS (automated) |
| Ticket values and credentials never logged | Captured every log record on the ticket-failure path and the success path (including the Redis-error branch that *does* log): no ticket value, no user id. The collector is proven live via a canary record. | **new** `test_tickets_and_user_ids_are_never_logged` | PASS (automated) |

### 4.2 Room authorization

| Requirement | Verified behaviour | Evidence | Status |
|---|---|---|---|
| Every join authorized against current DB state | `hub.is_participant()` → SQL `WHERE chat.id = :chat AND (buyer_id = :user OR seller_id = :user)` | `chat_realtime.py` `db_participant_check`; `test_ws_hello_then_join_requires_participation` | PASS (automated, DB check itself stubbed) |
| Only the authorized buyer or seller can join | Non-participant gets `{"type":"error","code":"not_participant"}` and **no** `joined` ack and **no** presence broadcast to anyone | `test_denial_is_indistinguishable_from_a_missing_chat` (new) asserts `redis.published` is unchanged | PASS (automated) |
| Denial reveals nothing about existence | An existing chat the user is not in and a nonexistent chat produce identical frames (same code, only the client's own `chatId` echoed) | **new** `test_denial_is_indistinguishable_from_a_missing_chat` | PASS (automated) |
| A ticket authenticates a socket, not a room | Same ticket: denied for `CHAT_OTHER`, accepted for `CHAT_1` | **new** `test_frame_cannot_assert_another_identity` | PASS (automated) |
| Events cannot leak between rooms/users | `local_deliver` for a chat with no joined socket delivers 0 and nothing reaches the other sockets (proved by a following ordered `ping`/`pong`); joining sockets receive their own chat's events | **new** `test_events_never_cross_chats`; `local_deliver` scoping test | PASS (automated) |

### 4.3 Realtime behaviour

| Requirement | Verified behaviour | Evidence | Status |
|---|---|---|---|
| Messages persist in Neon via Prisma + HTTP API | `chat-service.ts` writes `tx.message.create` + `tx.chat.update` inside one `$transaction`; history/send/edit/delete/read are the existing HTTP path | code trace + **new** `chat-service-realtime.test.ts` | PASS (automated) |
| Redis is notification/coordination, not storage | Full realtime flow executed under a Redis client that **raises on any call other than `getdel`/`publish`/`pubsub`** | **new** `test_realtime_path_uses_redis_only_as_a_bus` | PASS (automated) |
| Publish only after the DB commits | Exact ordered timeline asserted: `db:message.insert → db:chat.update → db:commit → redis:publish:malihub:chat:events`; a failed write, a non-participant sender and a blocked recipient each publish nothing | **new** `chat-service-realtime.test.ts` (9 tests, incl. ordering + negative cases) | PASS (automated) |
| Create / edit / delete / read events | `message` published after commit; `message_update` after edit and after (soft) delete with `content: null`; `messages_read` carries ids collected **before** the bulk update and is skipped entirely when nothing is unread | **new** `chat-service-realtime.test.ts`; `chat-realtime-events.test.ts` (shape, deleted row, fire-and-forget) | PASS (automated) |
| Typing notifications + throttling | Server window (`chat_ws_typing_window_seconds`, default 1.5 s) enforced with a test; client throttle 1.5 s/chat | `test_ws_typing_is_throttled_server_side`; ws-client "sendTyping is throttled per chat" | PASS (automated) |
| Heartbeat + watchdog | Client pings every 25 s, closes itself if no pong within 65 s; server closes an idle socket with 4000 | **new** ws-client heartbeat test; **new** `test_watchdog_closes_an_idle_socket` | PASS (automated) |
| Reconnect + backoff + cleanup | Unexpected close → exponential backoff (1 s → 30 s, 20 attempts), then stops; fresh `subscribe()` re-arms; re-connects re-join every room; last unsubscribe releases the socket | **new** ws-client tests; **note:** cap only works after defect 2 was fixed | PASS (automated, after fix) |
| Multi-tab presence | Presence is per user; closing one of two tabs does not announce offline | `test_multi_tab_presence_only_flips_on_last_socket` | PASS (automated) |
| Cross-instance fan-out | Control events stamped with the origin instance id, echoed back are skipped; message events relayed to local sockets | `test_pump_relays_foreign_control_events_and_skips_echoes`, `test_broadcast_control_publishes_for_other_instances` | PASS (automated) |
| Redis outage degrades, no data loss, no insecure fallback | No Redis → ticket route 503, client stays inactive, chat works over HTTP; publish failures are swallowed after commit; backend hub without Redis is local-only with a warning | `ws-ticket-route.test.ts` (503 cases), `chat-realtime-events.test.ts` ("never throws"), `test_start_without_redis_is_a_local_only_noop`, **new** ticket-failure test | PASS (automated) |
| Malformed / oversized frames handled safely | Non-JSON or non-object frames → `bad_message`, 3 violations → close 4003; > `chat_ws_max_frame_bytes` → close 4009; unknown command types counted as violations; client parser drops malformed inbound frames | `test_ws_oversized_frame_closes_4009`, `test_ws_unknown_type_counts_as_violation`, ws-client parser tests | PASS (automated) |
| WebSocket origin / CSWSH policy | The socket is authenticated by ticket only; the handshake is origin-independent and grants nothing — no cookie is read, and a foreign `Origin` header with no/unknown ticket still closes 4401. Tickets can only be minted by a same-origin, CSRF-checked, session-authenticated POST. | **new** `test_origin_header_grants_nothing`; `verifySameOrigin` in the ticket route | PASS (automated) |
| Connection and rate limits | ≤10 joined chats/connection (test with the cap set to 1), ≤256 KB frames, server-side typing window, 60 s watchdog, 20 tickets/min/user | **new** `test_connection_chat_cap_is_enforced`; existing frame/typing tests | PASS (automated) |
| DoS residual | There is no per-user *concurrent connection* cap in the backend: a user may open many sockets, each bounded by the 60 s ticket issuance rate (20/min) and each holding ≤10 rooms, with 60 s watchdog reclamation. Accepted residual (bounded by the ticket rate limit); not changed in this phase to avoid a scope expansion. | code trace | REVIEWED |
| Live production behaviour (real Redis + real Neon + two browsers + two backend instances) | Requires the deployed environment | see §6 | **BLOCKED** |

`test_chat_realtime_security.py` (8 tests) and `chat-service-realtime.test.ts`
(9 tests) are new in this phase; no existing test was modified except the
ws-client suite, which gained 4 tests.

---

## 5. Cloudinary avatar acceptance and migration runbook

### 5.1 What was verified locally

| Requirement | Evidence | Status |
|---|---|---|
| Uploads use Cloudinary, no Supabase client | `src/app/api/avatar/upload/route.ts` imports only `@/lib/cloudinary`, Prisma, auth, CSRF, rate-limit and the magic-byte validator. No Supabase import anywhere in `src/` outside the rollback pair. | PASS |
| Cloudinary secret never reaches the browser | `CLOUDINARY_API_SECRET` is read only in `src/lib/cloudinary.ts`, which begins with `import "server-only"` (a client import fails the build). Signature assertions run server-side; the upload route is a route handler. `avatar-upload.tsx` reads no env var at all (grep: zero matches). The separate listing-image widget uses the unsigned preset (`NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`), which is public by design. | PASS |
| Authentication + profile ownership enforced | Same-origin (CSRF) check → session via `getCurrentUser()` → body carries no user id; the profile row is updated with `where: { userId }` from the session; public id is server-generated under `avatars/<userId>/`. Upload into another user's folder is structurally impossible. | PASS |
| File type/size validation | `classifyImageMagic()` (magic bytes, not `Content-Type`) restricted to JPEG/PNG/WebP; ≤3 MB; empty/absent field → 400; oversized → 413; wrong bytes → 415. | PASS |
| Cloudinary URLs restricted to our account and avatar folder | `isOwnCloudinaryAvatarUrl()` requires `res.cloudinary.com`, our `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `/image/upload/avatars/…`; `publicIdFromOwnAvatarUrl()` returns null for anything else (so a foreign URL can never be deleted). | PASS |
| Migration script deterministic | `deriveLegacyAvatarPublicId()` = `avatars/<owner>/migrated-<sha256(oldUrl)[:12]>` — same input, same id, no counters or timestamps. Owner/file segments are pattern-validated so a crafted URL cannot escape the `avatars/` scope. | PASS |
| Migration idempotent + safely resumable | Candidate query excludes rows already on Cloudinary and rows present in the mapping file; `--limit N` stops cleanly with "N more remain; rerun to continue"; the mapping file (`data/avatar-url-map.json`, gitignored) is the resume ledger. | PASS |
| Migration never deletes Supabase objects | No Supabase DELETE/destroy call exists anywhere in the script (or in the app): the only `destroy` in the codebase is `cloudinary.uploader.destroy` for a *previous Cloudinary* avatar in the upload route. | PASS |
| Invalid URLs / missing assets / failures handled safely | Rows that are not own-project avatars-bucket URLs are skipped with a log; a non-2xx download or non-image body is skipped with an error; per-row try/catch isolates failures; exit code = number of failures; nothing is written for a failed row. | PASS |
| Legacy Supabase avatar URLs remain valid until verification | `isOwnSupabaseStorageUrl` + the `avatarUrl` refine accept them; `next.config.ts` still allows `*.supabase.co` in `img-src` **and** `images.remotePatterns`; `NEXT_PUBLIC_SUPABASE_URL` remains the project reference both use. | PASS |
| Production data actually migrated | Not executed — requires production DB + Supabase + Cloudinary credentials and explicit operator authorization. **No claim is made about how many legacy avatar URLs exist in production.** | **NOT RUN** |

Supporting local tests: `scripts/__tests__/migrate-avatars.test.mjs` (12 tests,
`# pass 12 / # fail 0`), `src/app/api/avatar/__tests__/upload-route.test.ts`,
`src/lib/validations/__tests__/upload-security.test.ts`.

### 5.2 Migration runbook (operator-facing)

**1. Required environment variables (names only).** In the shell that runs the
script: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`. Values come from the production secret store — never
committed, never pasted into chat or a ticket.

**2. Pre-migration inventory and backup checks.**
- Take a database snapshot/backup (or confirm the most recent one) before any
  write; the script's only write is `Profile.avatarUrl`.
- Count the affected rows before starting:

  ```sql
  SELECT count(*) FROM profiles
   WHERE avatar_url LIKE 'https://<project-ref>.supabase.co/storage/v1/object/public/avatars/%';
  ```

- Confirm the bucket objects are still readable (a normal browser GET on one
  known legacy avatar URL should return 200).
- Ensure `data/` is writable by the operator running the script (the mapping
  file is written there) and that it is not committed.

**3. Dry run.** `node scripts/migrate-avatars-to-cloudinary.mjs --dry-run`
— prints `WOULD <old> → avatars/<owner>/migrated-<hash>` per candidate and
writes nothing. Reconcile the candidate count with step 2's count; a mismatch
means some rows are not own-project URLs (those are skipped by design).

**4. Batched execution and safe resume.**
`node scripts/migrate-avatars-to-cloudinary.mjs --limit 25`, then repeat until
the script reports no remaining candidates. Each batch appends to the mapping
file, so a rerun never re-uploads or duplicates: the public id is derived from
the old URL and the row drops out of the candidate set once mapped.

**5. Failure and recovery.** The exit code equals the number of failed rows;
failures are printed with the reason and are **not** written to the mapping
file, so a rerun retries exactly those. Partial failures leave a consistent
state: a row is only updated after its upload succeeded. Nothing is deleted on
either side, so recovery never requires restoring a Supabase object — worst case
is re-running the script.

**6. Verifying migrated records and image accessibility.**
- `SELECT count(*) FROM profiles WHERE avatar_url LIKE '%supabase.co/storage/v1/object/public/avatars/%';`
  should reach 0 (this is the gate for step 7).
- Spot-check N random migrated rows: `curl -sI <new_url>` → HTTP 200 with
  `image/*`, and open the profile page of the same user to confirm the avatar
  renders through `next/image`.
- Cross-check a sample against `data/avatar-url-map.json` (old → new).

**7. Criteria for removing legacy validation, image-host configuration and
`NEXT_PUBLIC_SUPABASE_URL`.** All of:
(a) the count in step 6 is 0; (b) every sampled new URL serves HTTP 200;
(c) a rollback window of at least one release cycle has passed with no
regression report. Then, in one commit: delete `isOwnSupabaseStorageUrl` and its
`authUrl` branch, the two `*.supabase.co` entries in `next.config.ts`
(`img-src` and `images.remotePatterns`), `NEXT_PUBLIC_SUPABASE_URL` from
`.env.example`, and the script's `NEXT_PUBLIC_SUPABASE_URL` dependency —
replacing the validator with the Cloudinary-only check and updating
`upload-security.test.ts` accordingly.

**8. Criteria for manually freezing/cleaning the old bucket.** Only after step 7,
and only manually: (a) export/verify a final copy of the bucket objects;
(b) set the bucket to read-only (or remove the app's ability to write — nothing
writes it any more); (c) after the rollback window, delete the objects and then
the bucket. No code path in this repository deletes Supabase storage, and
verification of any object count requires production access this sandbox does
not have.

---

## 6. Deployment architecture, configuration and environment inventory

### 6.1 Facts established from the code (not assumed)

| Question | Answer | Evidence |
|---|---|---|
| Exact WebSocket route | `/api/v1/chat/ws?ticket=<64-hex>`, registered as `chat_ws`; prefix is configurable via `API_V1_PREFIX` (default `/api/v1`) | `backend/app/api/v1/endpoints/chat.py`, `router.py` (`"chat_ws": f"{prefix}/chat/ws"`) |
| How the frontend obtains the WS URL | Server-side `POST /api/chat/ws-ticket` reads `NEXT_PUBLIC_CHAT_WS_BASE_URL`, strips trailing slashes, and returns `{success:true, data:{url:"<base>/api/v1/chat/ws?ticket=…"}}`. The browser (`ws-client.ts`) POSTs `{}` to that route and connects to `body.data.url` with the native `WebSocket`. | `src/app/api/chat/ws-ticket/route.ts`, `src/lib/chat/ws-client.ts` |
| Is the WS base exposed to the browser bundle? | No: `grep -rl CHAT_WS_BASE_URL .next/static` → no matches (server-side read only, despite the `NEXT_PUBLIC_` name) | build output |
| Ticket response format / client use | Route answers `{success, data:{url}}`; Redis key `malihub:api:chat:ws-ticket:<ticket>` = userId, TTL 60 s; backend accepts `^[0-9a-f]{32,64}$` and consumes with `GETDEL` | route + `consume_ticket()` |
| Redis client type (frontend) | **Upstash REST** — `@upstash/redis` with `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (only these two names are read) | `src/lib/redis.ts` |
| Redis client type (backend) | **Redis protocol URL** — `redis.asyncio` via `REDIS_URL` (secret), keys namespaced `malihub:api:…`; `UPSTASH_REDIS_REST_*` is not read by the backend | `backend/app/core/{config,redis}.py` |
| Do both stacks need the same Redis? | Yes — the same database reached two ways (REST from Next.js, TCP/TLS from FastAPI), documented in `backend/app/core/redis.py`; needed for ticket hand-off and cross-instance fan-out | `core/redis.py` docstring |
| HTTP CORS | Starlette `CORSMiddleware` with `CORS_ORIGINS` (required, non-`*`, in production) / `CORS_ORIGIN_REGEX`; it does not govern WebSockets | `backend/app/main.py`, `core/config.py` |
| WebSocket origin policy | No origin allowlist on the handshake; authorization is the ticket (unusable cross-origin without a same-origin, CSRF-checked, session-authenticated issuance). Tested: a foreign `Origin` with no/unknown ticket → 4401 | endpoint code + `test_origin_header_grants_nothing` |
| `NEXT_PUBLIC_API_BASE_URL` | Documented but **read by no code** in `src/` (see §2.2 defect 4) | grep |
| Deployment manifests in the repo | **None** — no Dockerfile, Procfile, `vercel.json`, `fly.toml`, or CI deploy config; the WS host is an operator decision documented in `docs/SUPABASE-REMOVAL-PLAN.md` §4 ("must hold persistent WebSocket connections … a serverless/HTTP-1.1-only host cannot run the WS endpoint") | repo listing |

### 6.2 Environment variables actually read (names only)

| Variable | Read by | Needed for | If absent |
|---|---|---|---|
| `NEXT_PUBLIC_CHAT_WS_BASE_URL` | ws-ticket route (server) | realtime tickets | ticket route 503 → chat is HTTP-only |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `src/lib/redis.ts` | tickets, rate limits, caches | limiters fail open, ticket route 503 |
| `REDIS_URL` | backend `core/redis.py` | ticket consumption, pump/fan-out, backend rate limits | hub runs local-only; backend limiters degrade |
| `DATABASE_URL`, `DIRECT_URL` | Prisma (app + script), SQLAlchemy (backend) | all persistence | hard failure of dependent routes |
| `NEON_AUTH_BASE_URL` (or alias `NEON_AUTH_URL`), `NEON_AUTH_COOKIE_SECRET` | `src/lib/auth/neon.ts` | sessions | middleware fails closed |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWT_ALGORITHMS`, `AUTH_PROVIDER` (default `neon`) | backend `core/{config,security}.py` | API auth | 503 fail-closed |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | upload route via `src/lib/cloudinary.ts`, migration script | avatar upload/migration | upload route 503 |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | listing-image widget (client) | listing images | widget cannot upload |
| `NEXT_PUBLIC_SUPABASE_URL` | legacy-avatar validator + migration script | legacy avatars only | legacy URLs stop validating |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | rollback files only (unreferenced) | nothing in the default deployment | no effect |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_*` (backend) | `core/{config,security}.py`, only when `AUTH_PROVIDER=supabase-legacy` | rollback only | no effect |
| `NEXT_PUBLIC_API_BASE_URL` | **nothing** | — | no effect |

Both `.env.example` files document the variables the code reads; the one
discrepancy found was fixed (§2.2 defect 4).

### 6.3 What cannot be verified from this sandbox — production acceptance is **BLOCKED**

There is no deployment access, no production credentials and no deployed
environment available here, so the following are **BLOCKED** (not run, not
inferred, not fabricated):

1. **FastAPI host capability and public WS URL** — whether the host keeps
   WebSocket connections open, its TLS/hostname, and the exact value of
   `NEXT_PUBLIC_CHAT_WS_BASE_URL` (must be the `wss://` base, no trailing slash
   required, no `/api/v1` suffix).
2. **Credential presence in each environment** — `UPSTASH_REDIS_REST_URL`/
   `_TOKEN` in the Next.js environment; `REDIS_URL` (same database, TCP/TLS) in
   the backend environment; and that neither value was pasted into this report.
3. **Connectivity** — FastAPI → Redis and FastAPI → Neon from the deployed
   network (this includes the `rediss://` vs `redis://` scheme Upstash requires).
4. **CORS/origin configuration on the real deployment** — the exact
   `CORS_ORIGINS` value, and the trusted callback origins for Neon Auth.
5. **End-to-end browser behaviour** — ticket → handshake → join → delivery, and
   degraded mode with Redis stopped.

**Exact next steps for each (safe, non-destructive):**
- Load the backend root (`/api/v1/health`) and `/api/v1/health/ready` from a
  machine that can reach it; ready must report database and Redis as healthy.
- From the frontend origin, sign in, open a chat, and confirm the Network tab
  shows `POST /api/chat/ws-ticket → 200` followed by a `101 Switching
  Protocols` to the host in `NEXT_PUBLIC_CHAT_WS_BASE_URL`. (Two authenticated
  test accounts, no real users; no messages need to be sent for the handshake —
  though a single message between the two test accounts is the minimal proof of
  delivery.)
- Send a message as user A and confirm user B's open thread receives it without
  a reload; then stop/disable Redis in a staging environment and confirm chat
  history and sending still work while live delivery is absent.
- Confirm the same Upstash database is referenced by both stacks (REST endpoint
  vs `REDIS_URL` host/port), then confirm the backend reports
  `is_multi_instance_capable` behaviour by running two instances behind the
  balancer and exchanging a message across them.

---

## 7. Complete remaining Supabase reference inventory and removal triggers

Re-scan command (72 files matched):

```
grep -ril supabase --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=.next --exclude-dir=.venv --exclude-dir=__pycache__ .
```

**No active runtime dependency exists in any category below.** Categories:

### A. Neon Auth rollback set — inert, imported by nothing (removal trigger: `docs/auth/MIGRATION.md` §9 conditions, i.e. stable cutover + completed user migration + no rollback exercised + backend no longer needs `SUPABASE_JWT_SECRET`)

`src/lib/supabase/auth-legacy.ts` (34 matches; the retired Supabase Auth
implementation), `src/lib/supabase/middleware.ts` (`updateSession()`),
`src/lib/supabase/server.ts` (service-role client used by the pair),
`src/types/supabase.ts` (`Database` type), `package.json` +
`package-lock.json` → `@supabase/ssr@0.5.2` (kept for those two files),
`backend/app/core/security.py` (`SupabaseJwtVerifier`),
`backend/app/core/config.py` (`SUPABASE_*` settings),
`backend/tests/{test_security,test_config,test_neon_auth,conftest,test_cors,test_errors,test_health,test_logging,test_models}.py`
(they pin the behaviour, including "no cross-provider fallback"),
both `.env.example` files (six rollback variables, each labelled).

### B. Legacy avatar compatibility — **required until the production migration is verified** (removal trigger: §5.2 step 7)

`src/lib/validations/upload-security.ts` (`isOwnSupabaseStorageUrl`),
`src/lib/validations/auth.ts` (the `avatarUrl` refine accepting either shape),
`next.config.ts` (`*.supabase.co` in `img-src` and `images.remotePatterns`),
`.env.example` → `NEXT_PUBLIC_SUPABASE_URL`, `scripts/migrate-avatars-to-cloudinary.mjs`
(+ its test file), and the code that documents "never delete a Supabase-hosted
avatar": `src/app/api/avatar/upload/route.ts` (+ test),
`src/lib/cloudinary.ts`, `src/components/auth/avatar-upload.tsx`.

### C. Historical SQL and schema record — **must not be deleted** (removal trigger: none; deleting production-applied DDL history is out of scope by instruction)

`prisma/migrations/manual_auth_trigger.sql`, `manual_rls_policies.sql`,
`manual_phase6_rls_realtime.sql`, `manual_phase7_security.sql`,
`manual_phase8_provider_agnostic_payments.sql`, `manual_product_search.sql`, and
the legacy-row notes in `prisma/schema.prisma` (`users.id` is the Supabase auth
UUID, `auth_user_id` is the mapping, audit-log actors).
**Note for completeness:** `prisma/migrations/manual_storage_avatars.sql` is
also historical Supabase Storage DDL (the `avatars` bucket and its policies) but
does not contain the word "supabase", so it does not appear in the grep above.
It describes the bucket existing avatars still live in and is covered by the
same trigger as category B.

### D. Backend documentation/prose about Supabase being *retired* (removal trigger: category A)

`backend/app/main.py` (OpenAPI text: "a Supabase-token verifier is retained
behind `AUTH_PROVIDER=supabase-legacy`, unselected by default"),
`backend/app/core/db.py`, `backend/app/core/logging.py`,
`backend/app/models/user.py`, `backend/app/providers/storage/{__init__,base}.py`,
`backend/app/services/storage_service.py`, `backend/pyproject.toml`
("No `supabase-py`"), `backend/.env.example`.

### E. Documentation (removal trigger: none — history; updated where it describes the current stack)

- **Current-state docs updated in Phases 4–5:** `README.md`, `ARCHITECTURE.md`,
  `docs/auth/MIGRATION.md`, `docs/SUPABASE-REMOVAL-PLAN.md`, this report,
  `docs/SUPABASE-REMOVAL-PHASE4-REPORT.md`.
- **Historical, left as written:** `docs/auth/ARCHITECTURE.md`,
  `docs/auth/REPORT.md`, `docs/neon-auth-poc/{AUDIT,REPORT}.md`,
  `.audit/{README.md,findings.json,coverage-ledger.json,validation-report.json,threat-model.md}`.

### F. Comment-only mentions in live code and tests (removal trigger: category A/B as applicable)

`src/app/(auth)/actions.ts`, `src/app/(auth)/reset-password/page.tsx`,
`src/app/(dashboard)/messages/layout.tsx`, `src/app/(marketing)/layout.tsx`,
`src/app/api/auth/callback/route.ts`, `src/lib/auth/{errors,index}.ts`,
`src/services/auth-service.ts`, `src/hooks/use-chat-socket.ts`,
`src/services/__tests__/chat-service-realtime.test.ts`,
`src/app/(auth)/__tests__/{complete-profile-action,sign-in-action}.test.ts`,
`src/lib/validations/__tests__/upload-security.test.ts`,
`src/app/api/avatar/__tests__/upload-route.test.ts` — each explains a
deliberate behaviour change, a legacy compatibility rule, or a safety property.

### G. Generated artefacts and transitive dependencies

- `tsconfig.tsbuildinfo` — **now untracked and gitignored** (Phase 5 defect 1);
  the file on disk is a local cache, not a dependency. It contains the string
  only because a source module path does.
- `backend/.pytest_cache/v/cache/nodeids` — gitignored test-runner cache.
- `@supabase/auth-js@2.79.0` — **transitive dependency of
  `@neondatabase/auth@0.5.0-beta`** (the current auth SDK), present in
  `node_modules`/lockfile but never imported by our code. Removal trigger: only
  when Neon Auth stops depending on it; not ours to remove.
- `package-lock.json` matches: the `@supabase/ssr` entry (category A) and the
  `@supabase/auth-js` entry above.

### H. Genuinely active references discovered during the audit

**None.** No file performs a Supabase network call, imports a Supabase client
outside the unreferenced rollback pair, or reads a Supabase credential in a live
path. Verified by: bundle inspection (§3), `grep -rn "from \"@supabase`
(only `src/lib/supabase/{middleware,server}.ts`), and
`grep -rn "process.env.SUPABASE" src/` (only those same files plus the legacy
validator's `NEXT_PUBLIC_SUPABASE_URL` read and tests).

---

## 8. Risks, rollback, outstanding blockers and final recommendation

### 8.1 Residual risks (accepted, documented — no code change in this phase)

| Risk | Impact | Mitigation already in place |
|---|---|---|
| Realtime depends on Redis for cross-instance delivery | With Redis down, only same-instance delivery works | Chat remains fully functional over HTTP; backend logs local-only mode; no fallback to an unauthenticated broadcast |
| Realtime depends on a WS-capable FastAPI host | A serverless host would disable live delivery | Client degrades to HTTP-only; documented deployment requirement (plan §4); must be confirmed (§6.3) |
| No per-user concurrent-connection cap (backend) | A user could open many sockets | 60 s single-use tickets rate-limited to 20/min/user; ≤10 rooms/connection; 60 s watchdog; 256 KB frame cap |
| Legacy avatar branch and rollback set remain in the tree | Dead-ish code, extra review surface | Documented triggers (§7 A/B), tests pin the legacy behaviour, and both are inert in the request path |
| `npm audit` residual (10 advisories, 0 critical, build-time only) | Supply-chain noise | Tracked as ASA-DEPS-001; unchanged since before Phase 4 |
| Production migration has not been run | Legacy avatars still on Supabase | Validators + `next/image` allowlist + CSP `img-src` keep them working; runbook in §5.2 |

### 8.2 Rollback

- **This phase** is a single commit: `git revert` restores the previous client
  behaviour, re-tracks the build cache (not recommended) and leaves the new
  tests in place harmlessly. No data, schema or dependency change is involved.
- **Phase 4** remains a single commit (`b6e3d5e`), revertible on its own.
- **Auth rollback** is unchanged and documented in `docs/auth/MIGRATION.md` §9 —
  starting with `npm install @supabase/supabase-js@2.117.3` (verified as a
  published version) and restoring `updateSession()` at the `src/middleware.ts`
  seam. Nothing in Phase 5 touched that path.
- **Avatar rollback** is a non-event: nothing was migrated or deleted; if the
  migration script is ever run, the mapping file (`data/avatar-url-map.json`) is
  the old→new ledger to reverse it row by row.

### 8.3 Outstanding blockers before the Supabase remnant can be removed entirely

1. **Avatar migration not run** (needs production credentials + operator
   authorization). Gates: §5.2 steps 3–6.
2. **Deployed WS/Redis acceptance not performed** — no deployment in this
   environment. Gates: §6.3.
3. **WS host capability unconfirmed** — persistent-connection hosting and the
   public `wss://` base URL.
4. **Supabase bucket freeze/cleanup** — manual, after verification (§5.2 step 8).
5. **Auth rollback window** — `docs/auth/MIGRATION.md` §9 conditions, plus the
   backend dropping `SUPABASE_JWT_SECRET`, before category A can go.

### 8.4 Recommendation

All code-level acceptance criteria that can be executed without production
access have been executed and pass, and the four defects found were fixed with
regression coverage. The remaining items are production verification, which this
environment cannot perform:

> ## `CONDITIONAL GO — code verified, production checks outstanding`

Merge PR #36 once the operator accepts that (a) the avatar migration and its
verification will be scheduled, (b) the deployed WebSocket/Redis handshake test
in §6.3 will be run in staging, and (c) the rollback/removal triggers in §7 are
kept on the roadmap. **Do not** remove `NEXT_PUBLIC_SUPABASE_URL`, the legacy
avatar validation, the `*.supabase.co` image allowances or the Neon Auth
rollback set before those checks pass.

---

## Appendix A — End-to-end acceptance matrix

Statuses: `PASS` (verified here, with evidence), `FAIL` (verification failed),
`BLOCKED` (cannot run here), `NOT RUN` (deliberately not executed).
"Automated" = unit/integration test executed in this sandbox; "Deployed" =
requires the live two-service deployment.

| Test | Environment | Procedure | Expected result | Actual result | Evidence | Status |
|---|---|---|---|---|---|---|
| Login and authenticated session | Local (automated) | Auth suites against the Neon Auth provider abstraction and guards | Session established, guards enforce role/onboarding from Postgres | Passing | `src/lib/auth/__tests__/{auth-units,guards,provider-integration}.test.ts`, `src/__tests__/middleware.test.ts` (part of the 722) | PASS |
| Avatar upload | Local (automated) | POST multipart to `/api/avatar/upload` with auth/origin/type/size variants | Valid image → Cloudinary URL + profile update; each invalid input → 400/401/403/413/415/429/503 | Passing (route tests) | `src/app/api/avatar/__tests__/upload-route.test.ts`; runbook §5.2 | PASS |
| Avatar upload (real Cloudinary account) | Deployed | Same POST against the real account | Asset created under `avatars/<userId>/…`, URL renders | Not executed — no Cloudinary credentials | §5.2 step 6 | BLOCKED |
| Existing avatar display | Local (automated) | Validate legacy + Cloudinary avatar URLs through the shared refine | Legacy Supabase URL accepted; Cloudinary avatar accepted; foreign hosts rejected | Passing | `upload-security.test.ts`, `next.config.ts` allowlist | PASS |
| Chat history retrieval | Local (automated) | Service/store and route tests for participant-scoped history | Only participants see messages; Prisma is the source | Passing | chat service tests in the 722 + backend model tests | PASS |
| Message send and persistence | Local (automated) | `sendMessage` through the fake-DB timeline | Row committed in the transaction before any Redis publish | Passing | `chat-service-realtime.test.ts` (new) | PASS |
| Message edit / delete / read events | Local (automated) | `editMessage`, `deleteMessage`, `markChatRead` | `message_update` after the update; `messages_read` with pre-collected ids; no publish on unauthorized/no-op paths | Passing | `chat-service-realtime.test.ts` (new) | PASS |
| Valid ticket + valid participant join | Local (automated) | Mint ticket in fake Redis, connect, `join` an owned chat | `hello` → `joined` with presence snapshot | Passing | `test_ws_two_users_message_and_typing_roundtrip` | PASS |
| Expired ticket | Local (automated) | Ticket absent from Redis (TTL expired) | Close 4401, no frames processed | Passing | `test_ws_rejects_missing_and_spent_tickets` (absent key path) | PASS |
| Reused ticket | Local (automated) | Connect twice with the same ticket | Second connect closed 4401 (`GETDEL`) | Passing | same test (spent-ticket half) | PASS |
| Unauthenticated ticket request | Local (automated) | POST `/api/chat/ws-ticket` with no session | 401, nothing stored | Passing | `ws-ticket-route.test.ts` | PASS |
| Unauthorized room join | Local (automated) | Join a chat the ticket's user is not in; also a nonexistent chat | Identical `not_participant` frames; no presence published | Passing | `test_denial_is_indistinguishable_from_a_missing_chat` (new) | PASS |
| Cross-user message isolation | Local (automated) | Deliver an event for a chat whose sockets are elsewhere; also verify per-room scoping | 0 deliveries; no leakage into other sockets' queues | Passing | `test_events_never_cross_chats` (new), `test_local_deliver_reaches_only_joined_sockets` | PASS |
| Typing notifications | Local (automated) | `typing` frames between two joined sockets + server window | Room receives one typing event per window | Passing | `test_ws_typing_is_throttled_server_side` | PASS |
| Multi-tab presence | Local (automated) | Two sockets for one user join; one leaves | Offline announced only when the last socket leaves | Passing | `test_multi_tab_presence_only_flips_on_last_socket` | PASS |
| Reconnect after disconnection | Local (automated) | Drop the socket; advance timers | Backoff retry opens a new socket and re-joins; bounded at 20 attempts; re-armed by a new subscribe | Passing after defect 2 fix | ws-client resilience tests (new) | PASS |
| Redis outage / degraded mode | Local (automated) | Ticket route with no Redis; publish failure after commit; hub with no Redis | 503 for realtime; HTTP chat unaffected; publish dropped, never thrown; hub local-only | Passing | `ws-ticket-route.test.ts`, `chat-realtime-events.test.ts`, `test_start_without_redis_is_a_local_only_noop` | PASS |
| WebSocket backend unavailable | Local (automated) | Ticket endpoint returns 503/500 | Client stays inactive, retries once per cooldown, chat works over HTTP | Passing | ws-client "degrades to HTTP-only" (new) | PASS |
| Cloudinary upload failure | Local (automated) | Cloudinary returns an error / is unconfigured | 502 (failure) or 503 (unconfigured); profile untouched; no partial write | Passing | `upload-route.test.ts` | PASS |
| Legacy avatar compatibility | Local (automated) | Validate and render legacy Supabase URL shapes | Accepted by the refine; `next/image` host allowlisted; CSP `img-src` allows it | Passing | `upload-security.test.ts`, `next.config.ts`, `auth.ts` | PASS |
| Production legacy-avatar census | Deployed | Run the SQL in §5.2 step 2 | Actual count of legacy rows | Not executed — no production DB access; **no claim made** | — | NOT RUN |
| Live ticket → WS handshake (real Redis, real FastAPI host) | Deployed | §6.3 step 2 | 200 ticket + 101 upgrade + `hello` on the wire | Not executed — no deployment access | — | BLOCKED |
| Live cross-user delivery + typing + presence | Deployed | §6.3 step 3 (two test accounts) | Second user receives events without reload | Not executed | — | BLOCKED |
| Live degraded mode (Redis stopped) | Deployed (staging) | §6.3 step 4 | History/send still work; no live push; no errors visible to users | Not executed | — | BLOCKED |
| Cross-instance fan-out | Deployed | §6.3 step 5 (two instances) | Message exchanged across instances arrives on both | Not executed | — | BLOCKED |
| Avatar migration execution | Deployed | §5.2 steps 3–6 | All legacy rows migrated; 0 remaining; images 200 | Deliberately not run (requires operator authorization) | — | NOT RUN |
