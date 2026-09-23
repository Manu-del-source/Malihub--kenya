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
