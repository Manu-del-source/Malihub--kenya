import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware tests for the Neon Auth migration.
 *
 * `src/lib/auth/neon.ts` is the ONLY module in the app that imports
 * `@neondatabase/auth`, and it is mocked at that import site — the same seam
 * strategy the previous suite used for `updateSession()`. Everything downstream
 * runs for real: route ownership (`@/lib/auth/config`), redirect construction
 * and open-redirect filtering (`@/lib/auth/redirects`), and `middleware()`
 * itself.
 *
 * ─── The invariant these tests exist to hold ───────────────────────────────
 * Middleware answers exactly ONE question: is there a valid session? It holds no
 * opinion about role, onboarding or seller access — those are read from
 * MaliHub's own Postgres rows by the guards in `src/lib/auth/session.ts`.
 *
 * That is not a stylistic preference. The previous implementation read
 * `onboarded`/`role`/`has_seller_profile` from the provider's `app_metadata`
 * JWT claims, and a claim that lagged the database produced a redirect loop
 * between the dashboard and /complete-profile — a bug this repository fixed
 * twice. There is no claim to lag now, so the loop is structurally impossible,
 * and "does not redirect an onboarded user" is no longer a middleware concern
 * at all. What middleware must still guarantee is narrower and sharper:
 *   - protected routes fail CLOSED when identity cannot be established,
 *   - public routes are never handed to the auth service,
 *   - an OAuth/link return is allowed to complete its session exchange,
 *   - and no crafted path can smuggle an external origin into `redirectTo`.
 */

type MiddlewareBehaviour =
  /** The SDK validated a session (or performed the verifier exchange). */
  | { kind: "pass" }
  /** The SDK found no session and redirected to the loginUrl it was given. */
  | { kind: "no-session" }
  /** The SDK threw — an unexpected failure rather than a clean "signed out". */
  | { kind: "throw" };

let behaviour: MiddlewareBehaviour = { kind: "no-session" };
/** null means Neon Auth is not configured for this deployment. */
let configured: boolean = true;
/** Every loginUrl middleware handed to the SDK, in order. */
const loginUrlsSeen: string[] = [];
let handlerCalls = 0;

mock.module("@/lib/auth/neon", {
  namedExports: {
    createNeonAuthMiddleware: (loginUrl: string) => {
      if (!configured) return null;
      loginUrlsSeen.push(loginUrl);
      return async () => {
        handlerCalls += 1;
        if (behaviour.kind === "throw") throw new Error("upstream exploded");
        if (behaviour.kind === "no-session") {
          return NextResponse.redirect(new URL(loginUrl, "https://malihub.test"));
        }
        return NextResponse.next();
      };
    },
  },
});

let middleware: typeof import("@/middleware")["middleware"] | null = null;
async function loadMiddleware() {
  middleware ??= (await import("@/middleware")).middleware;
  return middleware;
}

function requestFor(path: string) {
  return new NextRequest(new URL(`https://malihub.test${path}`));
}

function locationOf(response: Response): string {
  return response.headers.get("location") ?? "";
}

beforeEach(() => {
  behaviour = { kind: "no-session" };
  configured = true;
  loginUrlsSeen.length = 0;
  handlerCalls = 0;
});

describe("middleware — route ownership", () => {
  it("never hands a public route to the auth service", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    for (const path of ["/", "/products/iphone-13", "/sellers/yegon", "/login", "/register"]) {
      const response = await fn(requestFor(path));
      assert.equal(response.status, 200, `${path} should pass through untouched`);
      assert.equal(
        response.headers.get("x-middleware-next"),
        "1",
        `${path} should be NextResponse.next()`
      );
    }

    assert.equal(loginUrlsSeen.length, 0, "the SDK was never constructed for a public route");
    assert.equal(handlerCalls, 0);
  });

  it("treats /complete-profile as reachable while signed out", async () => {
    // It is an AUTH_ROUTE, not a protected one: an un-onboarded person must be
    // able to reach it, and gating it behind a session would deadlock onboarding.
    const fn = await loadMiddleware();
    const response = await fn(requestFor("/complete-profile"));

    assert.equal(response.status, 200);
    assert.equal(handlerCalls, 0);
  });

  it("hands every protected prefix to the auth service", async () => {
    const fn = await loadMiddleware();

    for (const path of [
      "/dashboard/buyer",
      "/dashboard/seller/listings",
      "/messages",
      "/messages/abc123",
      "/notifications",
    ]) {
      await fn(requestFor(path));
    }

    assert.equal(handlerCalls, 5, `expected 5 SDK invocations, saw ${handlerCalls}`);
  });

  it("does not treat a lookalike prefix as protected", async () => {
    const fn = await loadMiddleware();

    // `/dashboarding` shares a string prefix with `/dashboard` but is not the
    // same route segment; matching it would be a (harmless but wrong) overreach.
    await fn(requestFor("/dashboarding"));
    await fn(requestFor("/messages-archive"));

    assert.equal(handlerCalls, 0);
  });
});

describe("middleware — authentication decisions", () => {
  it("redirects a signed-out protected request to login with its destination", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    const response = await fn(requestFor("/dashboard/buyer"));

    assert.equal(response.status, 307);
    assert.match(locationOf(response), /\/login\?redirectTo=%2Fdashboard%2Fbuyer$/);
  });

  it("passes a protected request through when a session is valid", async () => {
    behaviour = { kind: "pass" };
    const fn = await loadMiddleware();

    const response = await fn(requestFor("/dashboard/seller"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  it("makes NO authorization decision — an onboarded seller and a fresh buyer are treated identically", async () => {
    // The regression this replaces: middleware used to bounce a session whose
    // `onboarded` claim predated the database write back to /complete-profile.
    // It cannot do that now, because it never reads application state. Two
    // requests with the same session validity must get the same answer.
    behaviour = { kind: "pass" };
    const fn = await loadMiddleware();

    const seller = await fn(requestFor("/dashboard/seller"));
    const buyer = await fn(requestFor("/dashboard/buyer"));

    assert.equal(seller.status, 200);
    assert.equal(buyer.status, 200);
    assert.ok(
      !locationOf(seller).includes("/complete-profile"),
      "middleware must never redirect to /complete-profile"
    );
  });

  it("preserves an existing query string in redirectTo", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    const response = await fn(requestFor("/messages?chat=42"));

    const location = new URL(locationOf(response));
    assert.equal(location.searchParams.get("redirectTo"), "/messages?chat=42");
  });
});

describe("middleware — OAuth and emailed-link returns", () => {
  it("runs the session exchange for an auth return on a NON-protected path", async () => {
    behaviour = { kind: "pass" };
    const fn = await loadMiddleware();

    // Google's callbackURL is /complete-profile — not a protected prefix. If
    // middleware skipped it, the verifier would never be exchanged and the
    // browser would land on MaliHub holding no session cookie at all.
    const response = await fn(
      requestFor("/complete-profile?neon_auth_session_verifier=one-time-value")
    );

    assert.equal(response.status, 200);
    assert.equal(handlerCalls, 1, "the SDK must run so it can exchange the verifier");
  });

  it("strips the one-time verifier from the redirectTo it records", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    await fn(requestFor("/dashboard/buyer?neon_auth_session_verifier=one-time-value"));

    assert.equal(loginUrlsSeen.length, 1);
    const loginUrl = new URL(loginUrlsSeen[0]!, "https://malihub.test");
    const redirectTo = loginUrl.searchParams.get("redirectTo");

    assert.equal(redirectTo, "/dashboard/buyer");
    assert.ok(
      !redirectTo?.includes("neon_auth_session_verifier"),
      "a one-time credential must never be persisted into a redirect target"
    );
    assert.ok(!loginUrlsSeen[0]!.includes("one-time-value"));
  });

  it("keeps other query parameters while stripping only the verifier", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    await fn(requestFor("/messages?chat=42&neon_auth_session_verifier=v"));

    const loginUrl = new URL(loginUrlsSeen[0]!, "https://malihub.test");
    assert.equal(loginUrl.searchParams.get("redirectTo"), "/messages?chat=42");
  });
});

describe("middleware — fails closed", () => {
  it("refuses a protected route when Neon Auth is not configured", async () => {
    configured = false;
    const fn = await loadMiddleware();

    const response = await fn(requestFor("/dashboard/buyer"));

    // A redirect rather than a throw: /login still renders and the auth actions
    // report the misconfiguration, instead of every dashboard URL returning an
    // opaque edge-runtime 500.
    assert.equal(response.status, 307);
    assert.match(locationOf(response), /\/login/);
    assert.equal(handlerCalls, 0);
  });

  it("lets an auth return through when unconfigured instead of looping", async () => {
    configured = false;
    const fn = await loadMiddleware();

    const response = await fn(
      requestFor("/complete-profile?neon_auth_session_verifier=v")
    );

    // Nothing to exchange; the landing page shows a signed-out state, which is
    // more useful than a redirect loop.
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  it("refuses a protected route when the SDK throws", async () => {
    behaviour = { kind: "throw" };
    const fn = await loadMiddleware();

    const response = await fn(requestFor("/dashboard/seller"));

    assert.equal(response.status, 307);
    assert.match(locationOf(response), /\/login\?redirectTo=%2Fdashboard%2Fseller$/);
  });

  it("does not throw out of the edge runtime when the SDK throws on an auth return", async () => {
    behaviour = { kind: "throw" };
    const fn = await loadMiddleware();

    const response = await fn(requestFor("/complete-profile?neon_auth_session_verifier=v"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

describe("middleware — open-redirect protection", () => {
  it("cannot be made to record an external origin as the destination", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    // A pathname cannot normally contain "//", but the encoded and backslash
    // forms are the ones that have historically slipped through a naive
    // `startsWith("/")` check.
    for (const crafted of [
      "/dashboard/buyer%2F%2Fevil.example",
      "/dashboard/..%2F..%2Fevil.example",
    ]) {
      await fn(requestFor(crafted));
    }

    for (const seen of loginUrlsSeen) {
      const redirectTo = new URL(seen, "https://malihub.test").searchParams.get("redirectTo") ?? "";
      assert.ok(
        !redirectTo.includes("evil.example") || redirectTo.startsWith("/dashboard/"),
        `unexpected redirectTo: ${redirectTo}`
      );
      assert.ok(!redirectTo.startsWith("//"), `protocol-relative redirectTo: ${redirectTo}`);
    }
  });

  it("always points the login redirect at a path on our own origin", async () => {
    behaviour = { kind: "no-session" };
    const fn = await loadMiddleware();

    await fn(requestFor("/dashboard/buyer"));

    const location = new URL(locationOf(await fn(requestFor("/messages"))));
    assert.equal(location.origin, "https://malihub.test");
    assert.equal(location.pathname, "/login");
  });
});
