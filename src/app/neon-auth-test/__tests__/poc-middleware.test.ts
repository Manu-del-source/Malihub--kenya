import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import {
  startMockAuthUpstream,
  type MockAuthUpstream,
} from "@/lib/neon-auth/__tests__/mock-auth-upstream";

/**
 * Composition test for `src/middleware.ts` after the Neon Auth POC landed.
 *
 * Two invariants are checked against the real middleware function:
 *  1. POC routes get Neon Auth behaviour (and only POC routes do), and
 *  2. every existing route keeps its Supabase behaviour — signed-out visitors
 *     are still sent to `/login` with the same `redirectTo` parameter.
 *
 * The only mocked boundary is `@/lib/supabase/middleware` (the same seam the
 * existing `src/__tests__/middleware.test.ts` uses); the Neon Auth middleware
 * itself runs for real, against the local mock upstream.
 */

const COOKIE_SECRET = "poc-cookie-secret-at-least-32-characters-long";
let upstream: MockAuthUpstream;

mock.module("@/lib/supabase/middleware", {
  namedExports: {
    updateSession: async () => ({ response: NextResponse.next(), user: null }),
  },
});

function requestFor(path: string, cookie?: string) {
  return new NextRequest(new URL(`https://malihub.test${path}`), {
    headers: cookie ? { cookie } : undefined,
  });
}

type MiddlewareFn = typeof import("@/middleware")["middleware"];
let middleware: MiddlewareFn;

/** Signs a POC user up through the SDK proxy and returns a Cookie header. */
async function sessionCookieHeader(): Promise<string> {
  const { createNeonAuth } = await import("@neondatabase/auth/next/server");
  const auth = createNeonAuth({
    baseUrl: upstream.baseUrl,
    cookies: { secret: COOKIE_SECRET },
    logLevel: "silent",
  });

  const { POST } = auth.handler();
  const response = await POST(
    new Request("http://localhost:3000/neon-auth-test/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `middleware-${Date.now()}@example.com`,
        password: "PocPassword123",
        name: "Middleware POC",
      }),
    }),
    { params: Promise.resolve({ path: ["sign-up", "email"] }) }
  );

  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

before(async () => {
  upstream = await startMockAuthUpstream();
  process.env.NEON_AUTH_BASE_URL = upstream.baseUrl;
  process.env.NEON_AUTH_COOKIE_SECRET = COOKIE_SECRET;
  delete process.env.NEON_AUTH_POC_ENABLED;
  delete process.env.NEON_AUTH_URL;
  middleware = (await import("@/middleware")).middleware;
});

after(async () => {
  await upstream.close();
  delete process.env.NEON_AUTH_BASE_URL;
  delete process.env.NEON_AUTH_COOKIE_SECRET;
});

describe("middleware — Neon Auth POC routes", () => {
  it("redirects an unauthenticated visitor away from the protected page", async () => {
    const response = (await middleware(requestFor("/neon-auth-test/protected"))) as NextResponse;

    assert.equal(response.status, 307);
    assert.equal(
      new URL(response.headers.get("location") ?? "", "https://malihub.test").pathname,
      "/neon-auth-test/sign-in"
    );
  });

  it("lets a signed-in visitor through and marks the request as middleware-verified", async () => {
    const cookie = await sessionCookieHeader();
    const response = (await middleware(
      requestFor("/neon-auth-test/protected", cookie)
    )) as NextResponse;

    assert.notEqual(response.status, 307);
    assert.equal(response.headers.get("location"), null);
    assert.equal(
      response.headers.get("x-middleware-request-x-neon-auth-middleware"),
      "true",
      "the Neon Auth middleware must stamp allowed requests"
    );
  });

  it("leaves the POC's public pages and its SDK proxy route unauthenticated-accessible", async () => {
    const landing = (await middleware(requestFor("/neon-auth-test"))) as NextResponse;
    assert.equal(landing.status, 200);
    assert.equal(landing.headers.get("location"), null);

    const signIn = (await middleware(requestFor("/neon-auth-test/sign-in"))) as NextResponse;
    assert.equal(signIn.status, 200);

    const proxy = (await middleware(
      requestFor("/neon-auth-test/api/auth/get-session")
    )) as NextResponse;
    assert.equal(proxy.status, 200);
    assert.equal(proxy.headers.get("location"), null);
  });

  it("does not call the Neon Auth upstream for cookie-cache hits", async () => {
    const cookie = await sessionCookieHeader();
    const before = upstream.countOf("GET /get-session");

    await middleware(requestFor("/neon-auth-test/protected", cookie));

    assert.equal(upstream.countOf("GET /get-session"), before);
  });
});

describe("middleware — existing Supabase routes are unchanged", () => {
  it("still redirects signed-out dashboard traffic to /login with redirectTo", async () => {
    const response = (await middleware(requestFor("/dashboard/buyer"))) as NextResponse;

    assert.equal(response.status, 307);
    assert.match(
      response.headers.get("location") ?? "",
      /\/login\?redirectTo=%2Fdashboard%2Fbuyer$/
    );
  });

  it("still allows the public and auth routes through", async () => {
    for (const path of ["/", "/login", "/register", "/products"]) {
      const response = (await middleware(requestFor(path))) as NextResponse;
      assert.equal(response.headers.get("location"), null, `unexpected redirect for ${path}`);
    }
  });

  it("never involves Neon Auth for a Supabase route", async () => {
    const before = upstream.requests.length;

    await middleware(requestFor("/dashboard/seller"));

    assert.equal(upstream.requests.length, before);
  });
});
