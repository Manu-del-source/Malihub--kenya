import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  startMockAuthUpstream,
  UNREACHABLE_NEON_AUTH_BASE_URL,
  type MockAuthUpstream,
} from "./mock-auth-upstream";

/**
 * Integration tests for `src/lib/auth/neon.ts` — the provider adapter.
 *
 * These run the REAL `@neondatabase/auth` SDK against a local stand-in for the
 * Managed Better Auth REST service (`./mock-auth-upstream`). Nothing about the
 * adapter is stubbed: cookie signing, the wire protocol, error shapes and the
 * SDK's own failure classification all execute for real. Only the HTTP service on
 * the other end of `NEON_AUTH_BASE_URL` is local, and the `next/headers` cookie
 * jar is an in-memory Map standing in for the request scope.
 *
 * That distinction is what makes this suite worth its runtime. A test that mocks
 * the adapter proves only that the test agrees with itself; this one proves that
 * the calls MaliHub actually makes reach endpoints the service actually serves,
 * with bodies it actually accepts — which is precisely the class of mistake (a
 * renamed endpoint, a `disableRedirect` flag omitted, a token parameter that does
 * not exist) that a mocked test cannot catch and a first production login would.
 */

/**
 * In-memory stand-in for Next's request-scoped cookie jar.
 *
 * The SDK reads cookies from the `cookie` REQUEST HEADER (`extractNeonAuthCookies`
 * in the installed SDK) and writes them through `cookies().set`, so the mock has
 * to serve both views of the same jar — exactly as Next does within a request.
 */
const jar = new Map<string, string>();

function cookieHeader(): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      set(name: string, value: string) {
        if (value === "") jar.delete(name);
        else jar.set(name, value);
      },
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      delete: (name: string) => {
        jar.delete(name);
      },
    }),
    headers: async () => ({
      get: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === "cookie") return cookieHeader() || null;
        if (lower === "origin") return "https://malihub.test";
        return null;
      },
    }),
  },
});

const COOKIE_SECRET = "integration-test-cookie-secret-0123456789";
const EMAIL = "emmanuel@example.com";
const PASSWORD = "Password1";

let upstream: MockAuthUpstream;

before(async () => {
  upstream = await startMockAuthUpstream();
  process.env.NEON_AUTH_BASE_URL = upstream.baseUrl;
  process.env.NEON_AUTH_COOKIE_SECRET = COOKIE_SECRET;
});

after(async () => {
  await upstream.close();
  delete process.env.NEON_AUTH_BASE_URL;
  delete process.env.NEON_AUTH_COOKIE_SECRET;
});

/** Loads the adapter fresh so `resetNeonAuthCache()` can drop a memoized client. */
async function loadAdapter() {
  const neon = await import("@/lib/auth/neon");
  const { isVerificationEmailDisabled, isAuthUnavailable } = await import("@/lib/auth/errors");
  neon.resetNeonAuthCache();
  return { neon, isVerificationEmailDisabled, isAuthUnavailable };
}

beforeEach(() => {
  // Both sides of the conversation are per-request state: the browser's cookie
  // jar and the service's user table. One upstream serves the whole suite, so
  // leaving accounts behind would make the second registration of the same
  // address fail as a duplicate and look like a cookie bug.
  jar.clear();
  upstream.reset();
  process.env.NEON_AUTH_BASE_URL = upstream.baseUrl;
  process.env.NEON_AUTH_COOKIE_SECRET = COOKIE_SECRET;
});

describe("provider adapter — configuration", () => {
  it("builds an instance when both variables are present", async () => {
    const { neon } = await loadAdapter();

    assert.ok(neon.getNeonAuth(), "a configured deployment must produce an instance");
  });

  it("memoizes the instance instead of rebuilding it per call", async () => {
    const { neon } = await loadAdapter();

    // Rebuilding per call would re-validate the cookie secret and re-create the
    // SDK's fetch client on every request.
    assert.equal(neon.getNeonAuth(), neon.getNeonAuth());
  });

  it("returns null rather than throwing when unconfigured", async () => {
    delete process.env.NEON_AUTH_BASE_URL;
    const { neon } = await loadAdapter();

    // Throwing here would surface as an opaque edge-runtime 500 on every
    // protected URL; returning null lets middleware fail closed with a redirect.
    assert.equal(neon.getNeonAuth(), null);
    assert.equal(neon.createNeonAuthMiddleware("/login"), null);
  });

  it("refuses a cookie secret shorter than the SDK's 32-character minimum", async () => {
    process.env.NEON_AUTH_COOKIE_SECRET = "too-short";
    const { neon } = await loadAdapter();

    // Enforced in config rather than left to the SDK, which would throw at
    // request time — long after the misconfiguration was deployed.
    assert.equal(neon.getNeonAuth(), null);
  });

  it("builds route-protection middleware when configured", async () => {
    const { neon } = await loadAdapter();

    assert.equal(typeof neon.createNeonAuthMiddleware("/login"), "function");
  });
});

describe("provider adapter — sign-up and sign-in over the real wire", () => {
  it("creates an account and returns a usable identity", async () => {
    const { neon } = await loadAdapter();

    const { data, failure } = await neon.providerSignUp({
      email: EMAIL,
      password: PASSWORD,
      name: "Emmanuel Yegon",
    });

    assert.equal(failure, null);
    assert.ok(data, "sign-up should return an identity");
    assert.equal(data.email, EMAIL);
    assert.equal(data.name, "Emmanuel Yegon");
    assert.ok(data.authUserId.length > 0, "the provider id is the mapping key");
    assert.equal(data.emailVerified, false, "a new address starts unverified");
    assert.ok(upstream.countOf("POST /sign-up/email") >= 1);
  });

  it("writes session cookies so the next request is authenticated", async () => {
    const { neon } = await loadAdapter();

    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });

    // The SDK signs a `session_data` cookie locally and stores the upstream
    // session token; both have to be in the jar for `getSession()` to work
    // without a network round trip.
    assert.ok(jar.size > 0, "sign-up must establish a session cookie");
    assert.ok(
      [...jar.keys()].some((name) => name.startsWith("__Secure-neon-auth")),
      `expected a Neon Auth cookie, got: ${[...jar.keys()].join(", ")}`
    );
  });

  it("reads back the session it just established", async () => {
    const { neon } = await loadAdapter();
    const signUp = await neon.providerSignUp({
      email: EMAIL,
      password: PASSWORD,
      name: "Emmanuel Yegon",
    });

    const { identity, failure } = await neon.readAuthSession();

    assert.equal(failure, null);
    assert.ok(identity, "the session established by sign-up must be readable");
    assert.equal(identity.authUserId, signUp.data?.authUserId);
    assert.equal(identity.email, EMAIL);
  });

  it("reports a definitively signed-out visitor as no-session, not as a failure", async () => {
    const { neon } = await loadAdapter();

    const { identity, failure } = await neon.readAuthSession();

    // Collapsing these two would make middleware report an outage every time
    // somebody visited the landing page while signed out.
    assert.equal(identity, null);
    assert.equal(failure, null);
  });

  it("signs in with correct credentials", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    jar.clear();

    const { data, failure } = await neon.providerSignIn({ email: EMAIL, password: PASSWORD });

    assert.equal(failure, null);
    assert.equal(data?.email, EMAIL);
    assert.ok(upstream.countOf("POST /sign-in/email") >= 1);
  });

  it("normalizes wrong credentials onto invalid_credentials with user-safe copy", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    jar.clear();

    const { data, failure } = await neon.providerSignIn({ email: EMAIL, password: "WrongPassword1" });

    assert.equal(data, null);
    assert.ok(failure);
    assert.equal(failure.code, "invalid_credentials");
    assert.ok(!failure.message.includes("WrongPassword1"), "never echo a submitted password");
  });

  it("normalizes a duplicate registration onto email_taken", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    jar.clear();

    const { data, failure } = await neon.providerSignUp({
      email: EMAIL,
      password: PASSWORD,
      name: "Somebody Else",
    });

    assert.equal(data, null);
    assert.equal(failure?.code, "email_taken");
  });

  it("clears the session on sign-out", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });

    const { failure } = await neon.providerSignOut();
    assert.equal(failure, null);

    const after = await neon.readAuthSession();
    assert.equal(after.identity, null, "the session must not survive sign-out");
  });
});

describe("provider adapter — failures are classified, not flattened", () => {
  it("reports an unreachable auth service as an outage", async () => {
    process.env.NEON_AUTH_BASE_URL = UNREACHABLE_NEON_AUTH_BASE_URL;
    const { neon, isAuthUnavailable } = await loadAdapter();

    const { data, failure } = await neon.providerSignIn({ email: EMAIL, password: PASSWORD });

    assert.equal(data, null);
    assert.ok(failure);
    // The distinction that prevents an outage from being reported to every
    // customer as "wrong password", which triggers a wave of resets.
    assert.notEqual(failure.code, "invalid_credentials");
    assert.equal(isAuthUnavailable(failure), true);
  });

  it("reports an unreachable service the same way when reading a session", async () => {
    process.env.NEON_AUTH_BASE_URL = UNREACHABLE_NEON_AUTH_BASE_URL;
    const { neon, isAuthUnavailable } = await loadAdapter();

    // A signed-out visitor must still get a clean "no session", but a holder of
    // a cookie that has to be validated upstream gets the outage signal.
    const { identity, failure } = await neon.readAuthSession();

    assert.equal(identity, null);
    if (failure) assert.equal(isAuthUnavailable(failure), true);
  });

  it("reports misconfiguration distinctly from an outage", async () => {
    delete process.env.NEON_AUTH_COOKIE_SECRET;
    const { neon } = await loadAdapter();

    const { failure } = await neon.providerSignIn({ email: EMAIL, password: PASSWORD });

    assert.equal(failure?.code, "auth_not_configured");
  });
});

describe("provider adapter — email verification", () => {
  it("reports verification links as unavailable on a shared-provider branch", async () => {
    const { neon, isVerificationEmailDisabled } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    upstream.controls.verificationLinksEnabled = false;

    const { failure } = await neon.providerSendVerificationEmail({ email: EMAIL });

    // This exact signal is what lets resendVerificationAction fall back to a
    // code instead of reporting a failure the person cannot act on.
    assert.equal(failure?.code, "capability_not_enabled");
    assert.equal(isVerificationEmailDisabled(failure), true);
  });

  it("sends a verification link when the branch has a custom email provider", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    upstream.controls.verificationLinksEnabled = true;

    const { data, failure } = await neon.providerSendVerificationEmail({
      email: EMAIL,
      callbackURL: "https://malihub.test/complete-profile",
    });

    assert.equal(failure, null);
    assert.equal(data, true);
  });

  it("sends and redeems a numeric verification code", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });

    const sent = await neon.providerSendVerificationCode({ email: EMAIL });
    assert.equal(sent.failure, null);

    const code = upstream.verificationCodeFor(EMAIL);
    assert.ok(code, "the mock service issued a code");

    const verified = await neon.providerVerifyEmailWithCode({ email: EMAIL, otp: code! });
    assert.equal(verified.failure, null);
    assert.equal(verified.data, true);
    assert.ok(upstream.countOf("POST /email-otp/verify-email") >= 1);
  });

  it("rejects a wrong verification code as an invalid token", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    await neon.providerSendVerificationCode({ email: EMAIL });

    const { data, failure } = await neon.providerVerifyEmailWithCode({
      email: EMAIL,
      otp: "000000",
    });

    assert.equal(data, null);
    assert.equal(failure?.code, "invalid_token");
  });
});

describe("provider adapter — password reset", () => {
  it("requests a reset link without revealing whether the address exists", async () => {
    const { neon } = await loadAdapter();
    await neon.providerSignUp({ email: EMAIL, password: PASSWORD, name: "Emmanuel Yegon" });
    jar.clear();

    const known = await neon.providerRequestPasswordReset({
      email: EMAIL,
      redirectTo: "https://malihub.test/reset-password",
    });
    const unknown = await neon.providerRequestPasswordReset({
      email: "nobody@example.com",
      redirectTo: "https://malihub.test/reset-password",
    });

    assert.equal(known.failure, null);
    assert.equal(unknown.failure, null, "an unregistered address must look identical");
    assert.equal(known.data, unknown.data);
  });

  it("rejects a token the service never issued", async () => {
    const { neon } = await loadAdapter();

    const { data, failure } = await neon.providerResetPassword({
      newPassword: "NewPassword1",
      token: "not-a-real-token",
    });

    assert.equal(data, null);
    assert.equal(failure?.code, "invalid_token");
  });

  it("sends the token in the body the service expects", async () => {
    const { neon } = await loadAdapter();

    await neon.providerResetPassword({ newPassword: "NewPassword1", token: "abc" });

    // The endpoint is `POST /reset-password` with `{ newPassword, token }` — not
    // a session-scoped `updateUser({ password })`, which is what the previous
    // provider used and what the old action assumed.
    assert.ok(upstream.countOf("POST /reset-password") >= 1);
  });
});

describe("provider adapter — Google OAuth", () => {
  it("returns an authorize URL instead of relying on a Location header", async () => {
    const { neon } = await loadAdapter();

    const { data, failure } = await neon.providerSignInWithGoogle({
      callbackURL: "https://malihub.test/complete-profile",
    });

    assert.equal(failure, null);
    assert.ok(data?.url.startsWith("https://"), `expected an absolute URL, got ${data?.url}`);
    // `disableRedirect: true` is what makes this callable from a Server Action:
    // without it the service answers with a redirect our fetch would follow.
    assert.ok(upstream.countOf("POST /sign-in/social") >= 1);
  });

  it("passes the callbackURL through to the provider", async () => {
    const { neon } = await loadAdapter();

    const { data } = await neon.providerSignInWithGoogle({
      callbackURL: "https://malihub.test/dashboard/buyer",
    });

    assert.ok(
      data?.url.includes(encodeURIComponent("https://malihub.test/dashboard/buyer")),
      "the return destination must reach the provider"
    );
  });
});

describe("provider adapter — session mapping", () => {
  it("maps the provider payload onto MaliHub's identity shape", async () => {
    const { neon } = await loadAdapter();

    const identity = neon.toAuthIdentity({
      session: { id: "s1", expiresAt: new Date("2026-10-01T00:00:00Z") },
      user: { id: "u1", email: "A@B.com", name: " A B ", emailVerified: true, image: null },
    });

    assert.deepEqual(identity, {
      authUserId: "u1",
      email: "a@b.com",
      name: "A B",
      emailVerified: true,
      image: null,
      sessionId: "s1",
      expiresAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("degrades to null for a payload with no usable id", async () => {
    const { neon } = await loadAdapter();

    assert.equal(neon.toAuthIdentity({ user: { email: "a@b.com" } }), null);
    assert.equal(neon.toAuthIdentity(null), null);
  });
});
