import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getNeonAuthPocConfig,
  isNeonAuthPocEnabled,
  isNeonAuthPocPath,
  isNeonAuthProtectedPath,
  isNeonAuthProxyPath,
} from "@/lib/neon-auth/config";
import {
  NEON_SESSION_ANONYMOUS,
  toNeonSessionView,
} from "@/app/neon-auth-test/session-view";

/**
 * Guard-rail tests for the "do not disturb production auth" requirement, plus
 * the session-payload mapping the POC pages rely on.
 *
 * These are intentionally not mock-everything tests: the enabled/disabled rules
 * and the payload mapping are pure functions, so they are exercised directly.
 */

const SECRET = "poc-cookie-secret-at-least-32-characters-long";
const CONFIGURED = {
  NEON_AUTH_BASE_URL: "https://ep-poc.neonauth.us-east-1.aws.neon.tech/neondb/auth",
  NEON_AUTH_COOKIE_SECRET: SECRET,
};

describe("Neon Auth POC — enablement guard", () => {
  it("stays disabled when nothing is configured", () => {
    assert.equal(isNeonAuthPocEnabled({ NODE_ENV: "development" }), false);
    assert.equal(getNeonAuthPocConfig({ NODE_ENV: "development" }), null);
  });

  it("is enabled in development once URL and secret are present", () => {
    assert.equal(isNeonAuthPocEnabled({ ...CONFIGURED, NODE_ENV: "development" }), true);
  });

  it("accepts the NEON_AUTH_URL alias supplied by the Neon Console", () => {
    const config = getNeonAuthPocConfig({
      NODE_ENV: "development",
      NEON_AUTH_URL: CONFIGURED.NEON_AUTH_BASE_URL,
      NEON_AUTH_COOKIE_SECRET: SECRET,
    });
    assert.equal(config?.baseUrl, CONFIGURED.NEON_AUTH_BASE_URL);
  });

  it("prefers NEON_AUTH_BASE_URL when both names are set", () => {
    const config = getNeonAuthPocConfig({
      NODE_ENV: "development",
      NEON_AUTH_BASE_URL: "https://primary.example/auth",
      NEON_AUTH_URL: "https://alias.example/auth",
      NEON_AUTH_COOKIE_SECRET: SECRET,
    });
    assert.equal(config?.baseUrl, "https://primary.example/auth");
  });

  it("refuses to run in production unless NEON_AUTH_POC_ENABLED=true", () => {
    assert.equal(isNeonAuthPocEnabled({ ...CONFIGURED, NODE_ENV: "production" }), false);
    assert.equal(
      isNeonAuthPocEnabled({ ...CONFIGURED, NODE_ENV: "production", NEON_AUTH_POC_ENABLED: "true" }),
      true
    );
  });

  it("refuses a NEXT_PUBLIC-only configuration (server-side variables are required)", () => {
    assert.equal(
      isNeonAuthPocEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_NEON_AUTH_URL: "https://public.example/auth",
      }),
      false
    );
  });
});

describe("Neon Auth POC — route ownership", () => {
  it("only claims /neon-auth-test/*", () => {
    assert.equal(isNeonAuthPocPath("/neon-auth-test"), true);
    assert.equal(isNeonAuthPocPath("/neon-auth-test/protected"), true);
    assert.equal(isNeonAuthPocPath("/neon-auth-testing"), false);
    assert.equal(isNeonAuthPocPath("/login"), false);
    assert.equal(isNeonAuthPocPath("/dashboard/buyer"), false);
    assert.equal(isNeonAuthPocPath("/api/auth/callback"), false);
  });

  it("separates the SDK proxy from the protected page", () => {
    assert.equal(isNeonAuthProxyPath("/neon-auth-test/api/auth/get-session"), true);
    assert.equal(isNeonAuthProxyPath("/api/auth/callback"), false);
    assert.equal(isNeonAuthProtectedPath("/neon-auth-test/protected"), true);
    assert.equal(isNeonAuthProtectedPath("/neon-auth-test/protected/child"), true);
    assert.equal(isNeonAuthProtectedPath("/dashboard/buyer"), false);
  });
});

describe("Neon Auth POC — session payload mapping", () => {
  it("maps an anonymous payload to the unauthenticated state", () => {
    assert.deepEqual(toNeonSessionView(null), NEON_SESSION_ANONYMOUS);
    assert.deepEqual(toNeonSessionView({ session: null, user: null }), NEON_SESSION_ANONYMOUS);
  });

  it("maps an authenticated payload without leaking the session token", () => {
    const view = toNeonSessionView({
      session: {
        id: "session-abc",
        token: "secret-token-must-not-be-rendered",
        expiresAt: "2026-10-01T10:00:00.000Z",
        createdAt: "2026-09-24T10:00:00.000Z",
      },
      user: {
        id: "Kf3vQ1n0E2xYpR7tLmZaBcD9HsJ4UgW8",
        email: "poc-test-account@example.com",
        name: "POC Test Account",
        emailVerified: false,
      },
    });

    assert.equal(view.authenticated, true);
    assert.equal(view.userId, "Kf3vQ1n0E2xYpR7tLmZaBcD9HsJ4UgW8");
    assert.equal(view.email, "poc-test-account@example.com");
    assert.equal(view.emailVerified, false);
    assert.equal(view.sessionId, "session-abc");
    assert.equal(view.expiresAt, "2026-10-01T10:00:00.000Z");
    assert.equal(JSON.stringify(view).includes("secret-token"), false);
  });

  it("degrades to unauthenticated for malformed payloads instead of throwing", () => {
    assert.deepEqual(toNeonSessionView("not-an-object"), NEON_SESSION_ANONYMOUS);
    assert.deepEqual(toNeonSessionView({ user: { email: "no-id@example.com" } }), NEON_SESSION_ANONYMOUS);
    assert.deepEqual(toNeonSessionView({ user: null, session: { id: "orphan" } }), NEON_SESSION_ANONYMOUS);
  });
});
