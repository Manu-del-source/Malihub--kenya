import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

/**
 * Regression test for the middleware half of the post-onboarding redirect
 * loop (src/middleware.ts).
 *
 * `src/lib/supabase/middleware.ts`'s `updateSession()` is the only
 * Next-runtime-bound dependency (it builds a cookie-backed Supabase client
 * for the edge); it is mocked at its import site — the same seam strategy as
 * the action-level test. Everything downstream (`middleware()` itself, its
 * onboarding/role checks, `NextResponse.redirect`) runs for real.
 *
 * Invariant: once onboarding is complete and the session carries the
 * refreshed claims (`onboarded: true` — exactly what the
 * `refreshSession()` fix in completeProfileAction puts into the browser's
 * cookie), a request to the buyer/seller dashboard must NOT be bounced back
 * to /complete-profile. The stale-claims case (pre-fix session) documents the
 * loop condition this protects against.
 */

/** The `user` the mocked updateSession reports for the current request. */
let sessionUser: Record<string, unknown> | null = null;

mock.module("@/lib/supabase/middleware", {
  namedExports: {
    updateSession: async () => ({
      response: NextResponse.next(),
      user: sessionUser,
    }),
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

/** The claims a JWT minted AFTER completeUserProfile's app_metadata sync carries. */
const ONBOARDED_BUYER = {
  app_metadata: { role: "BUYER", has_seller_profile: false, onboarded: true },
};

const ONBOARDED_SELLER = {
  app_metadata: { role: "SELLER", has_seller_profile: true, onboarded: true },
};

/** The claims the browser's JWT carried BEFORE the session refresh: the
 * profile is committed server-side but the token still says "not onboarded". */
const STALE_PRE_ONBOARDING = {
  app_metadata: { role: "BUYER", has_seller_profile: false },
};

function assertNoRedirectTo(response: Response, forbiddenPath: string) {
  const location = response.headers.get("location");
  assert.ok(
    location === null || !location.includes(forbiddenPath),
    `expected no redirect to ${forbiddenPath}, got ${response.status} → ${location}`
  );
}

describe("middleware — onboarded users reach their dashboard (redirect-loop regression)", () => {
  beforeEach(() => {
    sessionUser = null;
  });

  it("does NOT redirect a fully onboarded buyer away from /dashboard/buyer", async () => {
    sessionUser = ONBOARDED_BUYER;
    const middlewareFn = await loadMiddleware();

    const response = await middlewareFn(requestFor("/dashboard/buyer"));

    assertNoRedirectTo(response, "/complete-profile");
  });

  it("does NOT redirect a fully onboarded seller away from /dashboard/seller", async () => {
    sessionUser = ONBOARDED_SELLER;
    const middlewareFn = await loadMiddleware();

    const response = await middlewareFn(requestFor("/dashboard/seller"));

    assertNoRedirectTo(response, "/complete-profile");
  });

  it("still redirects a session whose claims predate onboarding (the loop condition)", async () => {
    sessionUser = STALE_PRE_ONBOARDING;
    const middlewareFn = await loadMiddleware();

    const response = await middlewareFn(requestFor("/dashboard/buyer"));

    // This is the bounce the completeProfileAction session-refresh fix
    // eliminates: with `onboarded !== true` in the session the dashboard
    // request is sent back to /complete-profile.
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /\/complete-profile$/);
  });

  it("redirects signed-out dashboard requests to login, as before", async () => {
    sessionUser = null;
    const middlewareFn = await loadMiddleware();

    const response = await middlewareFn(requestFor("/dashboard/buyer"));

    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /\/login\?redirectTo=%2Fdashboard%2Fbuyer$/);
  });
});

const ADMIN_ONBOARDED = {
  app_metadata: { role: "ADMIN", has_seller_profile: false, onboarded: true },
};

const SUPER_ADMIN_ONBOARDED = {
  app_metadata: { role: "SUPER_ADMIN", has_seller_profile: false, onboarded: true },
};

describe("middleware — full decision matrix (lightweight, JWT-claims only)", () => {
  beforeEach(() => {
    sessionUser = null;
  });

  it("unauthenticated: protected routes → login (with redirect-back), public routes pass", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = null;

    for (const path of ["/dashboard/buyer", "/dashboard/seller", "/dashboard/admin"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.status, 307, path);
      assert.ok(
        (response.headers.get("location") ?? "").includes("/login?redirectTo="),
        `${path} → login`,
      );
    }

    for (const path of ["/", "/products", "/about", "/login", "/register"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.headers.get("location"), null, `${path} must pass through`);
    }
  });

  it("incomplete user: dashboards → /complete-profile, onboarding-exempt routes pass", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = { app_metadata: { role: "BUYER", has_seller_profile: false } }; // no onboarded key

    for (const path of ["/dashboard/buyer", "/dashboard/seller", "/dashboard/admin", "/login"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.status, 307, path);
      assert.ok(
        (response.headers.get("location") ?? "").endsWith("/complete-profile"),
        `${path} → complete-profile`,
      );
    }

    for (const path of ["/complete-profile", "/forgot-password", "/reset-password", "/verify-email", "/api/products"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.headers.get("location"), null, `${path} is onboarding-exempt`);
    }
  });

  it("onboarded buyer: /dashboard/buyer passes; /dashboard/seller is gated to the buyer dashboard", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = ONBOARDED_BUYER;

    const buyer = await middlewareFn(requestFor("/dashboard/buyer"));
    assert.equal(buyer.headers.get("location"), null);

    const sellerAttempt = await middlewareFn(requestFor("/dashboard/seller"));
    assert.equal(sellerAttempt.status, 307);
    assert.ok((sellerAttempt.headers.get("location") ?? "").endsWith("/dashboard/buyer"));

    const adminAttempt = await middlewareFn(requestFor("/dashboard/admin"));
    assert.equal(adminAttempt.status, 307);
    assert.ok((adminAttempt.headers.get("location") ?? "").endsWith("/"));
  });

  it("onboarded seller: both dashboards pass (a seller can still buy)", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = ONBOARDED_SELLER;

    for (const path of ["/dashboard/seller", "/dashboard/buyer"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.headers.get("location"), null, path);
    }
  });

  it("a buyer whose stale cache claims a seller profile is allowed at the edge (Neon/RLS remain authoritative)", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = {
      app_metadata: { role: "BUYER", has_seller_profile: true, onboarded: true },
    };

    const response = await middlewareFn(requestFor("/dashboard/seller"));
    assert.equal(response.headers.get("location"), null, "edge gate is the cache check; the data path re-validates");
  });

  it("ADMIN: admin dashboard passes; seller dashboard passes (support access)", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = ADMIN_ONBOARDED;

    for (const path of ["/dashboard/admin", "/dashboard/seller", "/dashboard/buyer"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.headers.get("location"), null, path);
    }
  });

  it("SUPER_ADMIN: same passes as ADMIN", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = SUPER_ADMIN_ONBOARDED;

    for (const path of ["/dashboard/admin", "/dashboard/seller"]) {
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.headers.get("location"), null, path);
    }
  });

  it("onboarded user hitting an auth route is sent to the dashboard", async () => {
    const middlewareFn = await loadMiddleware();
    sessionUser = ONBOARDED_BUYER;

    for (const path of ["/login", "/register", "/forgot-password"]) {
      // /forgot-password is onboarding-exempt for the onboarding check, but
      // the auth-route bounce applies once onboarded — middleware redirects.
      const response = await middlewareFn(requestFor(path));
      assert.equal(response.status, 307, path);
      assert.ok((response.headers.get("location") ?? "").endsWith("/dashboard/buyer"), path);
    }
  });

  it("never queries Neon and never invents state: the only input is the (live) session user", async () => {
    // Structural guarantee of the lightweight contract: the middleware module
    // must not import Prisma or any service layer.
    const source = (await import("node:fs")).readFileSync(
      new URL("../middleware.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!/from ["']@\/lib\/prisma/.test(source), "no Prisma import in middleware");
    assert.ok(!/from ["']@\/services\//.test(source), "no service-layer import in middleware");
    assert.ok(!/\$transaction|findMany|findFirst/.test(source), "no data access in middleware");
  });
});
