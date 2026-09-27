import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authFailure,
  isAuthUnavailable,
  isVerificationEmailDisabled,
  toAuthFailure,
} from "@/lib/auth/errors";
import { loginUrlWithRedirect, safeInternalRedirect } from "@/lib/auth/redirects";
import {
  isAuthRoutePath,
  isProtectedPath,
  pathWithoutVerifierParam,
  resolveNeonAuthBaseUrl,
  resolveNeonAuthCookieSecret,
  shouldLinkUnmappedAccountsByEmail,
  getNeonAuthConfig,
} from "@/lib/auth/config";
import { toAuthIdentity } from "@/lib/auth/neon";

/**
 * Unit tests for the three edge-safe modules plus the provider's session mapper.
 *
 * These need no mocks and no database, which is exactly why they matter: they
 * are the pieces that run in the edge runtime on every request, and a mistake in
 * one of them is either an open redirect or a route that fails open.
 */

describe("toAuthFailure — provider errors become MaliHub's contract", () => {
  it("maps a wrong-password response onto invalid_credentials", () => {
    const failure = toAuthFailure(
      { message: "Invalid email or password", status: 401 },
      "unknown"
    );

    assert.equal(failure.code, "invalid_credentials");
    assert.match(failure.message, /email or password/i);
  });

  it("maps a duplicate email onto email_taken", () => {
    const failure = toAuthFailure({ message: "User already exists", status: 422 }, "unknown");

    assert.equal(failure.code, "email_taken");
    assert.match(failure.message, /already exists/i);
  });

  it("maps throttling onto rate_limited rather than a generic failure", () => {
    const failure = toAuthFailure({ message: "Too many requests", status: 429 }, "unknown");

    assert.equal(failure.code, "rate_limited");
    assert.match(failure.message, /wait a minute/i);
  });

  it("maps a bad reset token onto invalid_token", () => {
    const failure = toAuthFailure(
      { message: "Invalid or expired reset token", status: 400 },
      "unknown"
    );

    assert.equal(failure.code, "invalid_token");
  });

  it("uses the caller's fallback code for an unrecognized error", () => {
    const failure = toAuthFailure(
      { message: "Something entirely novel", status: 418 },
      "invalid_credentials"
    );

    assert.equal(failure.code, "invalid_credentials");
    assert.equal(failure.status, 418);
  });

  it("reports misconfiguration distinctly from a credential problem", () => {
    const failure = toAuthFailure(null, "auth_not_configured");

    assert.equal(failure.code, "auth_not_configured");
    assert.match(failure.message, /sign-in|configured|support/i);
  });

  it("treats transport failures as an outage, never as wrong credentials", () => {
    // The distinction that matters most: during an auth-service outage, telling
    // every customer their password is wrong causes a wave of resets and
    // lockouts for a problem that is entirely on our side.
    for (const message of [
      "fetch failed",
      "Network request failed",
      "socket hang up",
      "ETIMEDOUT",
    ]) {
      const failure = toAuthFailure({ message, status: 502 }, "invalid_credentials");
      assert.notEqual(
        failure.code,
        "invalid_credentials",
        `"${message}" must not read as a wrong password`
      );
    }
  });

  it("classifies an unconfigured branch as unavailable", () => {
    assert.equal(isAuthUnavailable(toAuthFailure(null, "auth_not_configured")), true);
    assert.equal(
      isAuthUnavailable(toAuthFailure({ message: "fetch failed", status: 502 }, "unknown")),
      true
    );
    assert.equal(
      isAuthUnavailable(toAuthFailure({ message: "Invalid email or password", status: 401 }, "unknown")),
      false
    );
  });

  it("never puts a token or secret into user-facing copy", () => {
    const failure = toAuthFailure(
      { message: "Invalid token: eyJhbGciOiJIUzI1NiJ9.secret-value", status: 400 },
      "unknown"
    );

    assert.ok(!failure.message.includes("eyJhbGciOiJIUzI1NiJ9"));
    assert.ok(!failure.message.includes("secret-value"));
  });

  it("authFailure produces usable copy for every code without a provider error", () => {
    for (const code of [
      "invalid_credentials",
      "email_taken",
      "email_not_verified",
      "invalid_token",
      "rate_limited",
      "weak_password",
      "auth_unavailable",
      "auth_not_configured",
      "account_banned",
      "app_database_unavailable",
      "no_application_user",
      "capability_not_enabled",
      "unknown",
    ] as const) {
      const failure = authFailure(code);
      assert.equal(failure.code, code);
      assert.ok(failure.message.length > 10, `${code} needs real copy, got "${failure.message}"`);
    }
  });
});

describe("verification-email capability detection", () => {
  it("recognizes the exact phrasing the shared-provider branch returns", () => {
    const failure = toAuthFailure(
      { message: "Verification email isn't enabled", status: 400 },
      "unknown"
    );

    assert.equal(failure.code, "capability_not_enabled");
    assert.equal(isVerificationEmailDisabled(failure), true);
  });

  it("accepts the raw provider error as well as a normalized failure", () => {
    assert.equal(
      isVerificationEmailDisabled({ message: "Verification email is not enabled", status: 400 }),
      true
    );
    assert.equal(isVerificationEmailDisabled(null), false);
    assert.equal(isVerificationEmailDisabled({ message: "Too many requests", status: 429 }), false);
  });

  it("does not mistake a rate limit for a missing capability", () => {
    // Conflating these would silently switch a working link flow onto codes
    // whenever somebody clicked "resend" too often.
    const failure = toAuthFailure({ message: "Too many requests", status: 429 }, "unknown");

    assert.notEqual(failure.code, "capability_not_enabled");
    assert.equal(isVerificationEmailDisabled(failure), false);
  });
});

describe("safeInternalRedirect — open-redirect filtering", () => {
  it("accepts an ordinary internal path", () => {
    assert.equal(safeInternalRedirect("/dashboard/buyer"), "/dashboard/buyer");
    assert.equal(
      safeInternalRedirect("/dashboard/buyer/wishlist?sort=recent#top"),
      "/dashboard/buyer/wishlist?sort=recent#top"
    );
  });

  it("rejects a protocol-relative URL", () => {
    assert.equal(safeInternalRedirect("//evil.example/steal"), null);
  });

  it("rejects a backslash-normalized URL", () => {
    // Browsers collapse `/\\host` into `//host`, so a naive `startsWith("/")`
    // check accepts an external origin here.
    assert.equal(safeInternalRedirect("/\\evil.example"), null);
    assert.equal(safeInternalRedirect("/\\/evil.example"), null);
  });

  it("rejects an absolute external URL", () => {
    assert.equal(safeInternalRedirect("https://evil.example/steal"), null);
    assert.equal(safeInternalRedirect("http://malihub.test.evil.example"), null);
  });

  it("rejects javascript: and data: schemes", () => {
    assert.equal(safeInternalRedirect("javascript:alert(1)"), null);
    assert.equal(safeInternalRedirect("data:text/html,<script>"), null);
  });

  it("rejects empty and missing values", () => {
    assert.equal(safeInternalRedirect(""), null);
    assert.equal(safeInternalRedirect(undefined), null);
    assert.equal(safeInternalRedirect(null), null);
  });

  it("normalizes a path that tries to climb out of the origin", () => {
    const result = safeInternalRedirect("/dashboard/../../evil");
    assert.ok(result === null || result.startsWith("/"), `unexpected: ${result}`);
    assert.ok(!(result ?? "").includes(".."), "dot segments must not survive");
  });
});

describe("loginUrlWithRedirect", () => {
  it("attaches a safe destination", () => {
    assert.equal(
      loginUrlWithRedirect("/login", "/dashboard/buyer"),
      "/login?redirectTo=%2Fdashboard%2Fbuyer"
    );
  });

  it("returns the bare login path for an unsafe destination", () => {
    assert.equal(loginUrlWithRedirect("/login", "//evil.example"), "/login");
    assert.equal(loginUrlWithRedirect("/login", ""), "/login");
  });

  it("preserves an existing query string on the destination", () => {
    const url = loginUrlWithRedirect("/login", "/messages?chat=42");
    assert.equal(new URL(url, "https://x.test").searchParams.get("redirectTo"), "/messages?chat=42");
  });
});

describe("route ownership", () => {
  it("protects the dashboard, messages and notifications prefixes", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/buyer",
      "/dashboard/seller/listings/123/edit",
      "/messages",
      "/messages/abc",
      "/notifications",
    ]) {
      assert.equal(isProtectedPath(path), true, `${path} should be protected`);
    }
  });

  it("does not protect a lookalike prefix", () => {
    assert.equal(isProtectedPath("/dashboarding"), false);
    assert.equal(isProtectedPath("/messages-archive"), false);
    assert.equal(isProtectedPath("/notificationsettings"), false);
  });

  it("leaves marketing, marketplace and auth routes public", () => {
    for (const path of [
      "/",
      "/products/iphone-13",
      "/sellers/yegon",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/complete-profile",
    ]) {
      assert.equal(isProtectedPath(path), false, `${path} should be public`);
    }
  });

  it("recognizes the auth routes that must stay reachable while signed out", () => {
    for (const path of [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/complete-profile",
    ]) {
      assert.equal(isAuthRoutePath(path), true, `${path} should be an auth route`);
    }
    assert.equal(isAuthRoutePath("/dashboard/buyer"), false);
  });

  it("strips only the one-time verifier parameter", () => {
    const url = new URL(
      "https://malihub.test/complete-profile?chat=42&neon_auth_session_verifier=secret"
    );

    assert.equal(pathWithoutVerifierParam(url), "/complete-profile?chat=42");
    assert.equal(
      pathWithoutVerifierParam(new URL("https://malihub.test/dashboard?neon_auth_session_verifier=s")),
      "/dashboard"
    );
  });
});

describe("environment resolution", () => {
  it("accepts a configured base URL and secret", () => {
    const env = {
      NEON_AUTH_BASE_URL: "https://branch.neonauth.aws.neon.tech",
      NEON_AUTH_COOKIE_SECRET: "k".repeat(32),
    };

    assert.equal(resolveNeonAuthBaseUrl(env), "https://branch.neonauth.aws.neon.tech");
    assert.equal(resolveNeonAuthCookieSecret(env), "k".repeat(32));
    assert.deepEqual(getNeonAuthConfig(env), {
      baseUrl: "https://branch.neonauth.aws.neon.tech",
      cookieSecret: "k".repeat(32),
    });
  });

  it("rejects a cookie secret shorter than the SDK's minimum", () => {
    // The SDK throws on a short secret at request time; refusing it here turns
    // that into the honest "not configured" path instead of a runtime 500.
    assert.equal(resolveNeonAuthCookieSecret({ NEON_AUTH_COOKIE_SECRET: "k".repeat(31) }), null);
    assert.equal(resolveNeonAuthCookieSecret({ NEON_AUTH_COOKIE_SECRET: "k".repeat(32) }), "k".repeat(32));
  });

  it("rejects a placeholder cookie secret copied from .env.example", () => {
    assert.equal(
      resolveNeonAuthCookieSecret({
        NEON_AUTH_COOKIE_SECRET: "your-cookie-secret-at-least-32-characters-long",
      }),
      null
    );
  });

  it("reports misconfiguration rather than guessing when either variable is absent", () => {
    // A half-configured deployment must fail closed, not fall back to some
    // default base URL that happens to resolve.
    assert.equal(getNeonAuthConfig({ NEON_AUTH_BASE_URL: "https://x.neon.tech" }), null);
    assert.equal(getNeonAuthConfig({ NEON_AUTH_COOKIE_SECRET: "s" }), null);
    assert.equal(getNeonAuthConfig({}), null);
  });

  it("ignores placeholder values left in an .env file", () => {
    for (const placeholder of [
      "your-neon-auth-base-url",
      "https://your-auth-url.neonauth.aws.neon.tech",
      "<NEON_AUTH_BASE_URL>",
      "not-a-url-at-all",
      "",
      "   ",
    ]) {
      assert.equal(
        resolveNeonAuthBaseUrl({ NEON_AUTH_BASE_URL: placeholder }),
        null,
        `"${placeholder}" should not count as configured`
      );
    }
  });

  it("keeps legacy email linking OFF unless explicitly enabled", () => {
    // Claiming an existing MaliHub row by email address is how a pre-migration
    // account gets mapped — and, if turned on carelessly, how one person could
    // claim another's account. It must be opt-in.
    assert.equal(shouldLinkUnmappedAccountsByEmail({}), false);
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "false" }), false);
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "0" }), false);
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "true" }), true);
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "1" }), true);
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "TRUE" }), true);
    // A typo must never be read as consent to attach one person's account to
    // another's.
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "ture" }), false);
    assert.equal(shouldLinkUnmappedAccountsByEmail({ MALIHUB_AUTH_LINK_UNMAPPED_BY_EMAIL: "maybe" }), false);
  });
});

describe("toAuthIdentity — defensive session mapping", () => {
  const validPayload = {
    session: { id: "session-1", expiresAt: new Date("2026-10-01T00:00:00Z") },
    user: {
      id: "auth-user-1",
      email: "Emmanuel@Example.com ",
      name: " Emmanuel Yegon ",
      emailVerified: true,
      image: "https://lh3.googleusercontent.com/a/x",
    },
  };

  it("maps a well-formed payload onto MaliHub's identity shape", () => {
    const identity = toAuthIdentity(validPayload);

    assert.ok(identity);
    assert.equal(identity.authUserId, "auth-user-1");
    assert.equal(identity.name, "Emmanuel Yegon", "surrounding whitespace is trimmed");
    assert.equal(identity.image, "https://lh3.googleusercontent.com/a/x");
    assert.equal(identity.sessionId, "session-1");
    assert.equal(identity.expiresAt, "2026-10-01T00:00:00.000Z");
  });

  it("lowercases and trims the email — it is a lookup key", () => {
    const identity = toAuthIdentity(validPayload);
    assert.equal(identity?.email, "emmanuel@example.com");
  });

  it("returns null rather than throwing for a payload with no user id", () => {
    // A malformed upstream response must degrade to "not authenticated" so the
    // caller fails closed, instead of crashing a page render.
    assert.equal(toAuthIdentity({ user: { email: "a@b.c" }, session: null }), null);
    assert.equal(toAuthIdentity({ user: { id: "   " } }), null);
    assert.equal(toAuthIdentity({ user: null, session: null }), null);
    assert.equal(toAuthIdentity({}), null);
    assert.equal(toAuthIdentity(null), null);
    assert.equal(toAuthIdentity(undefined), null);
    assert.equal(toAuthIdentity("auth-user-1"), null);
    assert.equal(toAuthIdentity(42), null);
  });

  it("tolerates a missing session block", () => {
    const identity = toAuthIdentity({ user: { id: "auth-user-1", email: "a@b.c" } });

    assert.ok(identity);
    assert.equal(identity.sessionId, null);
    assert.equal(identity.expiresAt, null);
  });

  it("treats an absent emailVerified flag as unverified", () => {
    // Failing open here would let an unverified address act as a verified one.
    assert.equal(
      toAuthIdentity({ user: { id: "a", email: "a@b.c" } })?.emailVerified,
      false
    );
    assert.equal(
      toAuthIdentity({ user: { id: "a", email: "a@b.c", emailVerified: "yes" } })?.emailVerified,
      false
    );
  });

  it("accepts an ISO string expiry as well as a Date", () => {
    assert.equal(
      toAuthIdentity({
        user: { id: "a", email: "a@b.c" },
        session: { id: "s", expiresAt: "2026-10-01T00:00:00.000Z" },
      })?.expiresAt,
      "2026-10-01T00:00:00.000Z"
    );
    assert.equal(
      toAuthIdentity({
        user: { id: "a", email: "a@b.c" },
        session: { id: "s", expiresAt: new Date("nonsense") },
      })?.expiresAt,
      null
    );
  });

  it("normalizes an empty name or image to null, not an empty string", () => {
    const identity = toAuthIdentity({ user: { id: "a", email: "a@b.c", name: "  ", image: "" } });

    assert.equal(identity?.name, null);
    assert.equal(identity?.image, null);
  });
});
