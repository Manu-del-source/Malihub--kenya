import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * `POST /api/chat/ws-ticket` at the route boundary.
 *
 * The endpoint is the only place a browser can trade its httpOnly session for
 * a WebSocket ticket, so its contract is the identity boundary of the whole
 * realtime surface:
 *  - the same-origin (CSRF) guard runs first, fail-closed;
 *  - no session / no MaliHub row → 401 (a session without an app row cannot
 *    join any chat, so a ticket would be useless);
 *  - per-user rate limit answers 429 + Retry-After;
 *  - realtime unconfigured (no WS base URL, no Redis, DB down) → 503 with the
 *    exact message the client treats as "realtime unavailable";
 *  - an optional `chatId` is participation-checked against the DB with the
 *    HTTP API's 404-for-non-participants rule (no existence oracle);
 *  - a successful issue stores `malihub:api:chat:ws-ticket:<ticket> = <userId>`
 *    with a 60s TTL and returns a `…/api/v1/chat/ws?ticket=…` URL built from
 *    the server config — never from the client.
 *
 * `@/lib/auth`, `@/lib/prisma`, `@/lib/rate-limit`, `@/lib/redis` are
 * substituted at the module boundary; the route handler, the CSRF guard and
 * the zod body validation all run for real.
 */

const APP_ORIGIN = "https://app.malihub.test";
const WS_BASE = "wss://api.malihub.test/"; // trailing slash on purpose (route must strip)
const USER_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const USER_B = "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d";
const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type ChatRow = { buyerId: string; sellerId: string };
const chats = new Map<string, ChatRow>([
  [CHAT_1, { buyerId: USER_A, sellerId: USER_B }],
]);

let dbError: Error | null = null;

const prismaProxy = new Proxy(
  {} as Record<string, unknown>,
  {
    get: (_target, property: string) => {
      if (property !== "chat") return undefined;
      return {
        findUnique: async ({ where }: { where: { id: string } }) => {
          if (dbError) throw dbError;
          return chats.get(where.id) ?? null;
        },
      };
    },
  }
);

const storedTickets = new Map<string, { userId: string; ex: number }>();
let redisAvailable = true;
let redisSetError: Error | null = null;

const redisProxy = {
  set: async (key: string, value: string, opts: { ex: number }) => {
    if (redisSetError) throw redisSetError;
    storedTickets.set(key, { userId: value, ex: opts.ex });
  },
};

let sessionUser: { id: string; email: string } | null = null;
let hasAppRow = true;
let rateLimitSuccess = true;

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
mock.module("@/lib/auth", {
  namedExports: {
    getCurrentUser: async () =>
      sessionUser
        ? {
            identity: { authUserId: "neon-1" },
            user: hasAppRow ? sessionUser : null,
          }
        : null,
  },
});
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: {
      chatWsTicket: async () => ({
        success: rateLimitSuccess,
        limit: 20,
        remaining: 19,
        reset: Date.now() + 60_000,
      }),
    },
    formatRetryAfter: () => "1m",
  },
});
mock.module("@/lib/redis", {
  namedExports: {
    getRedis: () => (redisAvailable ? redisProxy : null),
  },
});

let route: typeof import("@/app/api/chat/ws-ticket/route");

before(async () => {
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL = WS_BASE;
  route = await import("@/app/api/chat/ws-ticket/route");
});

beforeEach(() => {
  storedTickets.clear();
  dbError = null;
  redisAvailable = true;
  redisSetError = null;
  sessionUser = { id: USER_A, email: "a@example.com" };
  hasAppRow = true;
  rateLimitSuccess = true;
});

function request(body: unknown, origin: string | null = APP_ORIGIN): NextRequest {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  headers.set("content-type", "application/json");
  return new NextRequest(new URL("/api/chat/ws-ticket", APP_ORIGIN), {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("authentication and guards", () => {
  it("rejects a missing Origin header (403)", async () => {
    const res = await route.POST(request({}, null));
    assert.equal(res.status, 403);
    assert.equal(storedTickets.size, 0);
  });

  it("rejects a cross-origin request (403) without storing anything", async () => {
    const res = await route.POST(request({}, "https://evil.example"));
    assert.equal(res.status, 403);
    assert.equal(storedTickets.size, 0);
  });

  it("rejects an unauthenticated request (401)", async () => {
    sessionUser = null;
    const res = await route.POST(request({}));
    assert.equal(res.status, 401);
    assert.equal(storedTickets.size, 0);
  });

  it("rejects a session with no MaliHub row (401) — it could join no chat anyway", async () => {
    hasAppRow = false;
    const res = await route.POST(request({}));
    assert.equal(res.status, 401);
    assert.equal(storedTickets.size, 0);
  });

  it("answers 429 with Retry-After when rate-limited", async () => {
    rateLimitSuccess = false;
    const res = await route.POST(request({}));
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "rate_limited");
    assert.equal(storedTickets.size, 0);
  });
});

describe("degradation (realtime unavailable, chat still works over HTTP)", () => {
  it("503 when the WS base URL is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL;
    const res = await route.POST(request({}));
    assert.equal(res.status, 503);
    assert.equal(storedTickets.size, 0);
    process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL = WS_BASE;
  });

  it("503 when Redis is not configured", async () => {
    redisAvailable = false;
    const res = await route.POST(request({}));
    assert.equal(res.status, 503);
  });

  it("503 when the DB is down and a chatId pre-check was requested", async () => {
    dbError = new Error("connection refused");
    const res = await route.POST(request({ chatId: CHAT_1 }));
    assert.equal(res.status, 503);
    assert.equal(storedTickets.size, 0);
  });
});

describe("chatId participation pre-check", () => {
  it("404 for a chat the user is not part of (no existence oracle)", async () => {
    const res = await route.POST(request({ chatId: CHAT_2 }));
    assert.equal(res.status, 404);
    assert.equal(storedTickets.size, 0);
  });

  it("404 for a nonexistent chat — same answer as non-participant", async () => {
    const res = await route.POST(request({ chatId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));
    assert.equal(res.status, 404);
  });

  it("400 for a malformed chatId (zod uuid) instead of a 500", async () => {
    const res = await route.POST(request({ chatId: "not-a-uuid" }));
    assert.equal(res.status, 400);
    assert.equal(storedTickets.size, 0);
  });

  it("accepts a chatId the user IS part of", async () => {
    const res = await route.POST(request({ chatId: CHAT_1 }));
    assert.equal(res.status, 200);
    assert.equal(storedTickets.size, 1);
  });
});

describe("ticket issuance", () => {
  it("stores the ticket under the shared key with a 60s TTL and returns the WS URL", async () => {
    const res = await route.POST(request({}));
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    const url = new URL(body.data.url);
    assert.equal(url.origin, "wss://api.malihub.test");
    assert.equal(url.pathname, "/api/v1/chat/ws");
    const ticket = url.searchParams.get("ticket");
    assert.match(ticket ?? "", /^[0-9a-f]{64}$/);

    assert.equal(storedTickets.size, 1);
    const stored = storedTickets.get(`malihub:api:chat:ws-ticket:${ticket}`);
    assert.ok(stored, "ticket stored under the cross-stack key");
    assert.equal(stored.userId, USER_A);
    assert.equal(stored.ex, 60);
  });

  it("issues a ticket for the session user, never a client-supplied one", async () => {
    // The body has no identity field at all — the only id in play is the
    // session's.
    const res = await route.POST(request({}));
    assert.equal(res.status, 200);
    const body = await res.json();
    const ticket = new URL(body.data.url).searchParams.get("ticket");
    assert.equal(storedTickets.get(`malihub:api:chat:ws-ticket:${ticket}`)?.userId, USER_A);
  });

  it("sets no-store, issues unique tickets and ignores client-provided destinations", async () => {
    const first = await route.POST(request({ url: "wss://other.example" }));
    const second = await route.POST(request({ userId: USER_B }));
    assert.equal(first.headers.get("cache-control"), "no-store");
    const firstUrl = new URL((await first.json()).data.url);
    const secondUrl = new URL((await second.json()).data.url);
    assert.equal(firstUrl.origin, "wss://api.malihub.test");
    assert.notEqual(firstUrl.searchParams.get("ticket"), secondUrl.searchParams.get("ticket"));
    assert.equal(storedTickets.get(`malihub:api:chat:ws-ticket:${secondUrl.searchParams.get("ticket")}`)?.userId, USER_A);
  });

  it("does not issue a ticket for insecure or malformed configured destinations", async () => {
    for (const base of ["http://api.example", "ws://remote.example", "wss://user:pass@api.example", "wss://api.example?redirect=other", "wss://api.example/#fragment"]) {
      process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL = base;
      const res = await route.POST(request({}));
      assert.equal(res.status, 503, "invalid base must fail closed");
      assert.equal(storedTickets.size, 0);
    }
    process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL = WS_BASE;
  });

  it("503 when Redis rejects the write", async () => {
    redisSetError = new Error("timeout");
    const res = await route.POST(request({}));
    assert.equal(res.status, 503);
  });
});
