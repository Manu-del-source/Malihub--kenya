import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  startMockAuthUpstream,
  UNREACHABLE_NEON_AUTH_BASE_URL,
  type MockAuthUpstream,
} from "./mock-auth-upstream";

/**
 * End-to-end proof-of-concept coverage for the Managed Better Auth POC.
 *
 * The `@neondatabase/auth` SDK code under test is real: the proxy handler, the
 * HS256 session-data cookie minting/validation, the route-protection middleware
 * and the server-side session API all execute. Only the HTTP service behind
 * `baseUrl` is local (`./mock-auth-upstream`), because tests must never point
 * at MaliHub's production Neon branch.
 *
 * Covered here:
 *  - email/password sign-up and sign-in through the SDK proxy,
 *  - session persistence (signed session-data cookie survives a second request
 *    without an upstream round trip),
 *  - protected-route behaviour with and without a session,
 *  - sign-out and the protected route being blocked afterwards,
 *  - session retrieval failure handling when the upstream is unreachable.
 */

const COOKIE_SECRET = "poc-cookie-secret-at-least-32-characters-long";
const ORIGIN = "http://localhost:3000";
const PROTECTED_PATH = "/neon-auth-test/protected";
const SIGN_IN_PATH = "/neon-auth-test/sign-in";

/** Mutable cookie jar used by the mocked `next/headers` (server-side reads). */
let requestCookieHeader = "";
const setCookies: string[] = [];

mock.module("next/headers", {
  namedExports: {
    headers: async () => new Headers({ cookie: requestCookieHeader }),
    cookies: async () => ({
      get: (name: string) => {
        const match = new RegExp(`${name}=([^;]*)`).exec(requestCookieHeader);
        return match ? { name, value: match[1] } : undefined;
      },
      getAll: () => [],
      set: (name: string, value: string) => {
        setCookies.push(`${name}=${value}`);
      },
    }),
  },
});

type SdkModule = typeof import("@neondatabase/auth/next/server");

let sdk: SdkModule;
let upstream: MockAuthUpstream;

async function loadSdk(): Promise<SdkModule> {
  sdk ??= await import("@neondatabase/auth/next/server");
  return sdk;
}

function createAuth(baseUrl: string) {
  return sdk.createNeonAuth({ baseUrl, cookies: { secret: COOKIE_SECRET }, logLevel: "silent" });
}

function handlerContext(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function handlerRequest(url: string, init?: RequestInit) {
  return new Request(`${ORIGIN}${url}`, init);
}

/** Turns the Set-Cookie headers of a response into a request Cookie header. */
function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

function cookieNames(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split("=")[0] ?? "")
    .filter(Boolean);
}

/** Applies `Max-Age=0` Set-Cookie deletions the way a browser would. */
function applyCookieDeletions(cookieHeader: string, setCookies: string[]): string {
  const deleted = new Set(
    setCookies
      .filter((cookie) => /max-age=0/i.test(cookie))
      .map((cookie) => cookie.split("=")[0] ?? "")
  );

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie && !deleted.has(cookie.split("=")[0] ?? ""))
    .join("; ");
}

function middlewareRequest(cookieHeader: string): NextRequest {
  return new NextRequest(new URL(`${ORIGIN}${PROTECTED_PATH}`), {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

let accountCounter = 0;

/**
 * Signs a fresh POC user up through the proxy and returns the session cookies.
 * Each call uses a new address because the (realistic) mock upstream rejects
 * duplicate registrations, exactly like Managed Better Auth does.
 */
async function signUpThroughProxy(): Promise<{
  cookieHeader: string;
  email: string;
  response: Response;
}> {
  accountCounter += 1;
  const email = `poc-test-account-${accountCounter}@example.com`;
  const auth = createAuth(upstream.baseUrl);
  const { POST } = auth.handler();
  const response = await POST(
    handlerRequest("/neon-auth-test/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "PocPassword123", name: "POC Test Account" }),
    }),
    handlerContext("sign-up", "email")
  );

  return { cookieHeader: cookieHeaderFrom(response), email, response };
}

before(async () => {
  sdk = await loadSdk();
  upstream = await startMockAuthUpstream();
});

after(async () => {
  await upstream.close();
});

describe("Neon Auth POC — email/password sign-up, sign-in and session persistence", () => {
  it("creates an account through the SDK proxy and issues both session cookies", async () => {
    const { response, cookieHeader, email } = await signUpThroughProxy();

    assert.equal(response.status, 200);
    const body = (await response.json()) as { user?: { id?: string; email?: string } };
    assert.equal(body.user?.email, email);
    assert.match(String(body.user?.id), /^[A-Za-z0-9_-]{32}$/);

    const names = cookieNames(response);
    assert.ok(names.includes("__Secure-neon-auth.session_token"), `missing session_token in ${names}`);
    assert.ok(
      names.includes("__Secure-neon-auth.local.session_data"),
      `session_data cookie was not minted (got ${names})`
    );

    const sessionDataCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Secure-neon-auth.local.session_data="));
    const jwt = sessionDataCookie?.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    assert.equal(jwt.split(".").length, 3, "session_data cookie must be a signed JWS");
    assert.ok(cookieHeader.includes("session_token"));
    assert.equal(upstream.countOf("POST /sign-up/email"), 1);
  });

  it("rejects a duplicate sign-up with the upstream error message", async () => {
    const { email } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const { POST } = auth.handler();
    const response = await POST(
      handlerRequest("/neon-auth-test/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "PocPassword123", name: "Duplicate" }),
      }),
      handlerContext("sign-up", "email")
    );

    assert.equal(response.status, 422);
    const body = (await response.json()) as { message?: string };
    assert.equal(body.message, "User already exists");
  });

  it("signs in with the same credentials", async () => {
    const { email } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const { POST } = auth.handler();
    const response = await POST(
      handlerRequest("/neon-auth-test/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "PocPassword123" }),
      }),
      handlerContext("sign-in", "email")
    );

    assert.equal(response.status, 200);
    assert.ok(cookieNames(response).includes("__Secure-neon-auth.session_token"));
  });

  it("fails sign-in with a wrong password and issues no session", async () => {
    const { email } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const { POST } = auth.handler();
    const response = await POST(
      handlerRequest("/neon-auth-test/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password" }),
      }),
      handlerContext("sign-in", "email")
    );

    assert.equal(response.status, 401);
    assert.equal(cookieNames(response).includes("__Secure-neon-auth.session_token"), false);
  });

  it("serves later session reads from the signed cookie (no upstream round trip)", async () => {
    const { cookieHeader, email } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const { GET } = auth.handler();
    const upstreamCallsBefore = upstream.countOf("GET /get-session");

    const response = await GET(
      handlerRequest("/neon-auth-test/api/auth/get-session", { headers: { cookie: cookieHeader } }),
      handlerContext("get-session")
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { user?: { email?: string }; session?: { id?: string } };
    assert.equal(body.user?.email, email);
    assert.ok(body.session?.id);
    assert.equal(
      upstream.countOf("GET /get-session"),
      upstreamCallsBefore,
      "a valid session_data cookie must satisfy /get-session without calling Neon"
    );
  });

  it("returns a null session for an anonymous request", async () => {
    const auth = createAuth(upstream.baseUrl);
    const { GET } = auth.handler();
    const response = await GET(
      handlerRequest("/neon-auth-test/api/auth/get-session"),
      handlerContext("get-session")
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "null");
  });
});

describe("Neon Auth POC — middleware route protection", () => {
  it("redirects an unauthenticated request to the configured login URL", async () => {
    const auth = createAuth(upstream.baseUrl);
    const middleware = auth.middleware({ loginUrl: SIGN_IN_PATH });

    const response = await middleware(middlewareRequest(""));

    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location") ?? "", ORIGIN).pathname, SIGN_IN_PATH);
  });

  it("allows a request carrying a valid session and stamps the middleware header", async () => {
    const { cookieHeader } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const middleware = auth.middleware({ loginUrl: SIGN_IN_PATH });
    const upstreamCallsBefore = upstream.countOf("GET /get-session");

    const response = await middleware(middlewareRequest(cookieHeader));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(
      upstream.countOf("GET /get-session"),
      upstreamCallsBefore,
      "middleware must validate the signed session cookie locally"
    );
  });

  it("treats a session-data cookie without a session token as stale and blocks the request", async () => {
    const { response: signUpResponse } = await signUpThroughProxy();
    const sessionDataOnly = signUpResponse.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0] ?? "")
      .find((cookie) => cookie.startsWith("__Secure-neon-auth.local.session_data="));
    assert.ok(sessionDataOnly);

    const auth = createAuth(upstream.baseUrl);
    const middleware = auth.middleware({ loginUrl: SIGN_IN_PATH });
    const response = await middleware(middlewareRequest(sessionDataOnly));

    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location") ?? "", ORIGIN).pathname, SIGN_IN_PATH);
  });

  it("signs out, clears the session cookies and blocks the protected route afterwards", async () => {
    const { cookieHeader } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const { POST } = auth.handler();

    const signOut = await POST(
      handlerRequest("/neon-auth-test/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: cookieHeader },
      }),
      handlerContext("sign-out")
    );

    assert.equal(signOut.status, 200);
    const cleared = signOut.headers.getSetCookie();
    assert.ok(
      cleared.some(
        (cookie) => cookie.startsWith("__Secure-neon-auth.session_token=") && /Max-Age=0/i.test(cookie)
      ),
      `sign-out must delete the session token cookie (got ${cleared.join(" | ")})`
    );
    assert.ok(
      cleared.some(
        (cookie) =>
          cookie.startsWith("__Secure-neon-auth.local.session_data=") && /Max-Age=0/i.test(cookie)
      ),
      "sign-out must delete the cached session-data cookie"
    );

    // A browser applies those Max-Age=0 headers, so the next request carries no
    // session cookie at all.
    const browserCookieHeader = applyCookieDeletions(cookieHeader, cleared);
    assert.equal(browserCookieHeader, "");

    const middleware = auth.middleware({ loginUrl: SIGN_IN_PATH });
    const afterSignOut = await middleware(middlewareRequest(browserCookieHeader));

    assert.equal(afterSignOut.status, 307);
    assert.equal(new URL(afterSignOut.headers.get("location") ?? "", ORIGIN).pathname, SIGN_IN_PATH);
    assert.equal(upstream.countOf("POST /sign-out"), 1);
  });

  it("documents the session-cache window: replayed pre-sign-out cookies stay valid until they expire", async () => {
    // LIMITATION, captured deliberately: the signed session-data cookie is a
    // 5-minute cache. A client that keeps sending the cookies sign-out asked it
    // to delete still passes middleware until that cache expires, because the
    // middleware trusts the local signature and never re-asks Neon. Browsers
    // delete the cookies, so this only matters for a client that ignores them
    // (or a copied cookie jar). See docs/neon-auth-poc/REPORT.md §M.
    const { cookieHeader } = await signUpThroughProxy();
    const auth = createAuth(upstream.baseUrl);
    const { POST } = auth.handler();

    await POST(
      handlerRequest("/neon-auth-test/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: cookieHeader },
      }),
      handlerContext("sign-out")
    );

    const middleware = auth.middleware({ loginUrl: SIGN_IN_PATH });
    const replayed = await middleware(middlewareRequest(cookieHeader));
    assert.equal(replayed.status, 200);

    // …but a read that bypasses the cache sees the revocation immediately.
    const { GET } = auth.handler();
    const bypass = await GET(
      handlerRequest("/neon-auth-test/api/auth/get-session?disableCookieCache=true", {
        headers: { cookie: cookieHeader },
      }),
      handlerContext("get-session")
    );
    assert.equal(await bypass.text(), "null");
  });

  it("fails closed when the session cannot be retrieved (unreachable upstream)", async () => {
    const auth = createAuth(UNREACHABLE_NEON_AUTH_BASE_URL);
    const middleware = auth.middleware({ loginUrl: SIGN_IN_PATH });

    const response = await middleware(
      middlewareRequest("__Secure-neon-auth.session_token=unknown-token-value")
    );

    assert.equal(response.status, 307, "an unreachable auth server must not let the request through");
    assert.equal(new URL(response.headers.get("location") ?? "", ORIGIN).pathname, SIGN_IN_PATH);
  });

  it("reports a session retrieval error instead of throwing", async () => {
    const auth = createAuth(UNREACHABLE_NEON_AUTH_BASE_URL);
    const result = await auth.getSession();

    assert.equal(result.data, null);
    assert.ok(result.error, "the SDK must surface the upstream failure as an error result");
  });
});

describe("Neon Auth POC — server-side session API", () => {
  it("reads the authenticated user from the request cookies without hitting the network", async () => {
    const { cookieHeader, email } = await signUpThroughProxy();
    requestCookieHeader = cookieHeader;
    setCookies.length = 0;

    const auth = createAuth(upstream.baseUrl);
    const upstreamCallsBefore = upstream.countOf("GET /get-session");
    const { data, error } = await auth.getSession();

    assert.equal(error, null);
    assert.equal(data?.user?.email, email);
    assert.match(String(data?.user?.id), /^[A-Za-z0-9_-]{32}$/);
    assert.ok(data?.session?.expiresAt instanceof Date);
    assert.equal(
      upstream.countOf("GET /get-session"),
      upstreamCallsBefore,
      "the signed session-data cookie is the fast path for server components"
    );

    requestCookieHeader = "";
  });

  it("returns an unauthenticated result when no cookies are present", async () => {
    requestCookieHeader = "";
    const auth = createAuth(upstream.baseUrl);
    const { data, error } = await auth.getSession();

    assert.equal(data, null);
    assert.equal(error, null);
  });

  it("never sends a session cookie to the browser through a NEXT_PUBLIC variable", async () => {
    // Guard-rail for the isolation requirement: the POC reads its Auth URL and
    // cookie secret from server-side variables only.
    const { resolveNeonAuthBaseUrl, resolveNeonAuthCookieSecret } = await import(
      "@/lib/neon-auth/config"
    );

    const env = {
      NEON_AUTH_BASE_URL: "https://example.neonauth.neon.tech/neondb/auth",
      NEON_AUTH_COOKIE_SECRET: COOKIE_SECRET,
      NEXT_PUBLIC_NEON_AUTH_URL: "https://public.example",
    };

    assert.equal(resolveNeonAuthBaseUrl(env), "https://example.neonauth.neon.tech/neondb/auth");
    assert.equal(resolveNeonAuthCookieSecret(env), COOKIE_SECRET);
    assert.equal(resolveNeonAuthBaseUrl({ NEXT_PUBLIC_NEON_AUTH_URL: "https://public.example" }), null);
  });
});
