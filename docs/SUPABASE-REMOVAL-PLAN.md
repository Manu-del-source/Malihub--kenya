# Supabase Removal — Migration Plan (Phase 1 audit output)

> **Phase status:** Phases 2 (avatars → Cloudinary) and 3 (chat realtime →
> FastAPI WebSocket + Redis) are implemented; **Phase 4 (dependency removal) is
> complete as of 2026-10-12 on branch `arena/174af3cf-malihub-kenya`.** What was
> actually removed, what deliberately remains, the gate results and the
> outstanding production steps are in
> [`SUPABASE-REMOVAL-PHASE4-REPORT.md`](./SUPABASE-REMOVAL-PHASE4-REPORT.md).
> The audit and phase plan below are kept as written — they are the record of
> what §1 found, not a description of the current tree.

**Status:** plan v1 — 2026-10-12, branch `arena/8b21d47b-malihub-kenya`, HEAD `ee102f3`.
**Goal:** remove Supabase from the MaliHub runtime without breaking auth, database,
messaging, avatar upload, payments, or deployment. Neon (Postgres + Neon Auth)
stays; Cloudinary becomes the single file store; chat realtime moves to FastAPI
WebSockets fanned out over the shared Upstash Redis.

## 1. Verified inventory — every Supabase reference

### Active runtime code (replaced in Phases 2–3)
| Reference | Used for | Replacement |
| --- | --- | --- |
| `src/components/auth/avatar-upload.tsx` (`supabase.storage.from("avatars")`) | Avatar upload, browser→Supabase Storage with anon key | Server-side Cloudinary upload route (Phase 2) |
| `src/hooks/use-chat-realtime.ts` (`supabase.channel`, `postgres_changes`, presence, broadcast) | Live chat delivery/typing/presence | FastAPI WebSocket + Redis pub/sub (Phase 3) |
| `src/lib/supabase/client.ts` (`createBrowserClient`) | Client factory for the two rows above | Deleted (no remaining importers) |
| `src/lib/validations/upload-security.ts → isOwnSupabaseStorageUrl` | Gate on `Profile.avatarUrl` | Extended gate accepting Cloudinary avatar URLs; Supabase branch kept **legacy-only** until the avatar migration is verified (see §6) |
| `next.config.ts → images.remotePatterns: *.supabase.co /storage/v1/object/public/**` | Display of legacy avatar URLs | Kept until migration verified, then removed (follow-up) |

### Inactive — rollback targets (deliberately retained, documented)
| File | Why it stays |
| --- | --- |
| `src/lib/supabase/middleware.ts` | "RETAINED BUT INACTIVE" (own header): Supabase Auth session refresh; nothing imports it. Restoring Supabase Auth means re-pointing middleware here — a rollback that must stay a quick revert per `docs/auth/MIGRATION.md` §9. |
| `src/lib/supabase/auth-legacy.ts` | Retired Supabase Auth implementation, the documented rollback target. |
| `src/lib/supabase/server.ts` | Imported **only** by `auth-legacy.ts` (`createServiceRoleClient`). |
| `src/types/supabase.ts` | Generated `Database` type used by the rollback pair above. |
| `package.json → @supabase/ssr 0.5.2` | Required by the rollback pair. `@supabase/supabase-js` has no importer after Phase 3 → **removed**. |
| `backend/` Supabase JWT verification (`AUTH_PROVIDER=supabase-legacy`) | Fails closed unless explicitly selected; default is `neon`. Kept as the documented auth-cutover rollback. |
| `prisma/migrations/manual_*.sql` (RLS/realtime/storage) | Historical DDL; never rewritten. RLS/realtime files are Supabase-Postgres-only (their own headers say so); `manual_storage_avatars.sql` remains the Supabase-project bucket definition. |
| `SUPABASE_*` env vars in both `.env.example` | Marked rollback-only; the default Neon deployment needs none of them. |

### Documentation
`README.md`, `ARCHITECTURE.md`, `docs/auth/{ARCHITECTURE,MIGRATION,REPORT}.md`,
`docs/neon-auth-poc/*` — updated where they describe the *current* stack;
historical phase docs left as history. `backend/app/main.py` OpenAPI summary
still says "Supabase remains the identity provider" — stale, fixed.

### Dead dependency (unrelated to any live code)
`socket.io-client` is in `package.json` with **zero imports** in `src/` — removed in Phase 4.

## 2. Baseline (recorded before edits)

Git state: `ee102f3`, working tree clean (no unrelated user changes to preserve —
`git status` verified at the start of each phase).

Last full gate run before this migration (real exits): `tsc --noEmit` 0 ·
`npm run lint` 0 · `npm test` 640/640 0 · `next build` 0 · `npm audit` 1 (10
advisories, 0 critical — ASA-DEPS-001 residual) · backend `pytest` 467/467 0 ·
`ruff` 0 · `pip-audit` 0. Re-run after every phase; results in the final report.

## 3. Phase 2 — Avatars → Cloudinary (server-side, authenticated)

**Why the current design is unacceptable:** the browser uploads directly to the
Supabase bucket with the public anon key; the only write gate is the
`avatars` bucket's RLS (a Supabase-side setting we can't verify here). Listing
images already use Cloudinary with the same account — avatars join it.

**New flow (no client-side secret, no user-supplied URL):**
1. `AvatarUpload` (UI unchanged) POSTs the file as multipart to
   `POST /api/avatar/upload`.
2. Route handler (server-only): session auth via `getCurrentUser()` →
   fail-closed same-origin check (`verifySameOrigin`, the repo's CSRF pattern) →
   per-user rate limit (10/h, Upstash, null-safe like the rest of the app) →
   validation: field present, ≤ 3 MB (the old bucket's limit), MIME in
   jpeg/png/webp **and** magic-byte match → Cloudinary **authenticated** upload
   (`cloudinary` npm package, `CLOUDINARY_API_KEY/SECRET` server-only) to
   `avatars/{userId}/avatar-…`.
3. Profile row updated in the same request (ownership by construction — the
   actor is the session user; no client-supplied user id is ever trusted).
4. Client stores the returned `res.cloudinary.com/…` URL in the form (unchanged
   `onChange` contract → `completeProfile`/profile update flow untouched).

**Existing avatars:** `Profile.avatarUrl` keeps the Supabase URL until migrated;
the `avatarUrl` validator accepts **either** own-project Supabase Storage URL
(legacy) **or** own-Cloudinary avatar URL. The `*.supabase.co` `next/image`
pattern stays until the migration is verified, so legacy avatars still render.

**Migration script** `scripts/migrate-avatars-to-cloudinary.mjs`:
- finds every `Profile.avatarUrl` matching own-project Supabase Storage URLs;
- downloads (public-read URLs — no credentials), re-uploads to Cloudinary with a
  **deterministic public_id** (hash of the old URL) → reruns are idempotent and
  never duplicate;
- updates the row via Prisma; writes an old→new mapping to `data/avatar-url-map.json`
  (gitignored data artifact) for audit and recovery;
- `--dry-run`, `--limit`, per-row error isolation, exit code = failure count;
- **never deletes** Supabase objects (manual cleanup only after verification).
- Not executed in this sandbox (no network to Supabase/Cloudinary/Neon) —
  delivered + unit-tested on its pure logic; running it is a deployment step.

**Affected files:** `avatar-upload.tsx`, new `src/app/api/avatar/upload/route.ts`
(+ tests), `upload-security.ts` (+ test), `auth.ts` (avatarUrl refine),
`scripts/migrate-avatars-to-cloudinary.mjs` (+ tests), `.env.example` (comments).

## 4. Phase 3 — Chat realtime → FastAPI WebSockets + Upstash Redis

**Source of truth stays where it is today:** messages are persisted exclusively
through the existing authorized Next.js path (server action → `chat-service.ts`
→ Prisma, participant-checked, rate-limited). Realtime is a *push* layer on top.

**Topology (reuses existing infrastructure):**
- **Auth — single-use ticket, no session token on the wire.** The browser
  (cookie-authenticated on our origin) calls `POST /api/chat/ws-ticket`
  `{chatId}`. The route verifies the session, verifies **participation** in that
  chat (DB), rate-limits (20/min/user), and issues a 256-bit random ticket:
  `SET malihub:api:chat:ws-ticket:<ticket> <userId> NX EX 60`. Response:
  `{url: <absolute wss url>, ticket}`. The client opens
  `wss://<backend>/api/v1/chat/ws?ticket=…` with the **native** browser
  `WebSocket` (no SDK). The backend consumes the ticket with `GETDEL` — one
  use, 60 s lifetime, bound to one user. No `Authorization` header needed
  (browsers can't set WS headers), no long-lived token exposed, the existing
  Neon Auth cookie never leaves our origin.
- **One connection per user, many chats.** Client sends `join`/`leave`
  (server re-authorizes each join against Postgres — a chat id is a hint, not
  proof), so switching chats never opens a second socket and there are no
  duplicate subscriptions.
- **Delivery.** `chat-service.ts` (sendMessage / editMessage / deleteMessage /
  markChatRead) publishes a JSON event to Redis channel `malihub:chat:events`
  after each successful write (null-safe: no Redis → no push, HTTP still works).
  The backend runs a **ChatRealtimeHub** (started in the app `lifespan`) that
  subscribes to the channel and fans events out to local connections joined to
  that chat. Redis events are notifications only — the authoritative row is
  always the one in Postgres, fetched by the existing history API.
- **Typing + presence** originate on the backend (client → WS → hub): delivered
  to co-located connections directly and fanned out via channel
  `malihub:chat:control` for other instances (each event carries the origin
  instance id; its own echo is skipped). Presence is connection-state
  (best-effort, same class of guarantee as the Supabase presence it replaces).
- **Limits.** max frame 256 KB; typing ≤ 1/s/connection; ≤ 10 joined
  chats/connection; 25 s client heartbeat (`ping`/`pong`) with a 60 s server
  watchdog; per-user ticket rate limit covers reconnect abuse.
- **Degradation.** No `NEXT_PUBLIC_CHAT_WS_BASE_URL`, backend unreachable, or
  Redis down → the socket client stays inactive; history, sending, read status
  all work over HTTP (the UI already revalidates on send); typing/presence
  indicators are simply absent. No insecure fallback, no silent swap.

**Deployment assumption (documented, must be verified at deploy time):** the
FastAPI host must hold persistent WebSocket connections (long-lived worker,
e.g. Fly/Render/Railway/EC2 + uvicorn). A serverless/HTTP-1.1-only host cannot
run the WS endpoint — in that case the client degrades per above, and chat
remains fully functional (history + send) without live push. This cannot be
verified from this sandbox; it is a **deployment checklist item**, not a code
assumption the client depends on.

**Affected files (new):** frontend `src/lib/chat/protocol.ts`,
`src/lib/chat/ws-client.ts`, `src/hooks/use-chat-socket.ts`,
`src/app/api/chat/ws-ticket/route.ts`, `src/services/chat-realtime-events.ts`
(+ tests for each); backend `app/models/chat.py`, `app/services/chat_realtime.py`,
`app/api/v1/endpoints/chat.py`, router/lifespan/config wiring
(+ `backend/tests/test_chat_realtime.py`). **Modified:** `chat-service.ts`
(event publishing), `chat-thread.tsx` (one import line).

## 5. Phase 4 — Dependency removal (after 2+3 verified)

Remove: `@supabase/supabase-js`, `socket.io-client` (package.json + lockfile
regenerated with `npm install`), `src/lib/supabase/client.ts`,
`src/hooks/use-chat-realtime.ts`, all active imports.
Keep (documented rollback set, see §1): `@supabase/ssr`,
`src/lib/supabase/{middleware,server,auth-legacy}.ts`, `src/types/supabase.ts`,
backend `supabase-legacy` verifier, `manual_*.sql`, marked-legacy env vars,
`*.supabase.co` image pattern + legacy validator branch (both until the avatar
migration is verified in production — removing them earlier would break
un-migrated avatars, which the migration explicitly forbids).
Docs: `README.md`, `ARCHITECTURE.md`, `backend/app/main.py` summary.

## 6. Order of operations & stopping points

1. Phase 2 → full gates → commit.
2. Phase 3 → full gates (both stacks) → commit.
3. Phase 4 → full gates + repo-wide `supabase` scan → commit.
4. Final report with the §7 acceptance evidence.

**Stop conditions** (implement in phases and stop if a critical assumption
cannot be verified): the WS ticket flow assumes both stacks share one Upstash
database — verified in `backend/app/core/redis.py`'s own docstring ("Both are
shared"), so no stop. The avatar migration needs live Supabase/Cloudinary/Neon
access — cannot be executed here, so it ships as a script + tests + runbook,
explicitly NOT claimed run. If any gate regresses during implementation, stop
and fix before the next phase.

## 7. Acceptance (what "done" means, per the brief)

- All gates green on both stacks with real exit codes (reported, not assumed).
- `grep -ri supabase` across the repo returns only the documented rollback
  set, historical migrations, and docs — each explained.
- No active Supabase network calls from any client or server path.
- Default deployment env contains no required `SUPABASE_*` variable.
- Avatars: upload/update/display work; unauthorized upload attempts rejected;
  migration script idempotent and file-preserving.
- Chat: history/pagination/sending unchanged; live delivery, typing, presence
  across two authenticated users; a non-participant cannot join or receive
  another chat's events; Redis outage degrades to HTTP-only chat.
- Payments/orders untouched (their test suites re-run green).
