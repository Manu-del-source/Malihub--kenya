import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeAccountStore,
  type FakeStore,
} from "@/services/__tests__/fake-account-store";
import {
  installAuthActionMocks,
  RedirectSignal,
  type ProviderFixture,
} from "@/lib/auth/__tests__/provider-mock";

/**
 * The remaining auth Server Actions: password reset, email verification (both
 * the link and the code path), Google sign-in, and sign-out.
 *
 * Each of these changed shape in the migration, and the changes are the point of
 * these tests:
 *
 *  - **Password reset** used to be implied by a session. The old provider
 *    exchanged the emailed link for a logged-in "recovery" session at
 *    `/api/auth/callback`, so `resetPasswordAction` needed no token and simply
 *    called `updateUser({ password })`. The new provider issues a ONE-TIME TOKEN
 *    and establishes no session, so the token is now an explicit parameter and
 *    the action must work while signed out.
 *  - **Email verification** now has two paths, because verification LINKS need a
 *    custom email provider on the Neon branch while CODES work with the shared
 *    one. `resendVerificationAction` asks for a link, and falls back to a code
 *    when the service says links are not enabled.
 *  - **Google sign-in** no longer round-trips through a MaliHub route: the auth
 *    service owns the handshake and returns an authorize URL that the action
 *    hands to `redirect()`.
 */

const store: FakeStore = createFakeAccountStore();
const provider: ProviderFixture = installAuthActionMocks(store);

let actionModule: typeof import("@/app/(auth)/actions") | null = null;
async function loadAction() {
  actionModule ??= await import("@/app/(auth)/actions");
  return actionModule;
}

const EMAIL = "emmanuel@example.com";

beforeEach(() => {
  provider.reset();
  store.tables.users.clear();
  store.tables.profiles.clear();
  store.tables.sellers.clear();
});

describe("forgotPasswordAction", () => {
  it("asks the provider for a reset link pointing at /reset-password", async () => {
    const { forgotPasswordAction } = await loadAction();

    const result = await forgotPasswordAction({ email: EMAIL });

    assert.equal(result.success, true);
    const [args] = provider.calls.requestPasswordReset![0]!;
    // The service appends `?token=…` to this, and /reset-password reads it.
    assert.match((args as { redirectTo: string }).redirectTo, /\/reset-password$/);
    assert.match((args as { redirectTo: string }).redirectTo, /^https:\/\/malihub\.test/);
  });

  it("answers identically whether or not the address is registered", async () => {
    // Account enumeration: if a registered address produced different copy from
    // an unregistered one, the form would be a directory of MaliHub customers.
    const { forgotPasswordAction } = await loadAction();

    const known = await forgotPasswordAction({ email: EMAIL });
    const unknown = await forgotPasswordAction({ email: "nobody@example.com" });

    // Captured before any assertion: `assert.equal(x.success, true)` narrows the
    // discriminated union, after which the failure branch is unreachable and
    // `.error` stops type-checking.
    const outcomeOf = (result: typeof known) => ({
      success: result.success,
      error: result.success ? null : result.error,
    });
    const knownOutcome = outcomeOf(known);
    const unknownOutcome = outcomeOf(unknown);

    assert.equal(known.success, true);
    assert.equal(unknown.success, true);
    assert.deepEqual(knownOutcome, unknownOutcome);
  });

  it("reports an outage instead of telling someone to check their email", async () => {
    provider.failure = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { forgotPasswordAction } = await loadAction();

    const result = await forgotPasswordAction({ email: EMAIL });

    // Still safe: this reveals nothing about whether the address exists, because
    // the service is down for everybody equally.
    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /couldn't reach the sign-in service/i);
  });

  it("rejects a malformed address without contacting the provider", async () => {
    const { forgotPasswordAction } = await loadAction();

    const result = await forgotPasswordAction({ email: "nope" });

    assert.equal(result.success, false);
    assert.ok(result.fieldErrors?.email);
    assert.deepEqual(provider.events, []);
  });
});

describe("resetPasswordAction — token-based, works while signed out", () => {
  it("completes a reset with a valid one-time token", async () => {
    provider.resetTokens.set("valid-token", EMAIL);
    const { resetPasswordAction } = await loadAction();

    const result = await resetPasswordAction(
      { password: "NewPassword1", confirmPassword: "NewPassword1" },
      "valid-token"
    );

    assert.equal(result.success, true, result.success ? "" : result.error);
    assert.equal(result.success && result.data.redirectTo, "/login");
  });

  it("does NOT require an authenticated session", async () => {
    // The structural change: the old action called `getUser()` first and refused
    // without a recovery session. This one is reached from an emailed link while
    // signed out, so requiring a session would make reset impossible.
    provider.session = null;
    provider.resetTokens.set("valid-token", EMAIL);
    const { resetPasswordAction } = await loadAction();

    const result = await resetPasswordAction(
      { password: "NewPassword1", confirmPassword: "NewPassword1" },
      "valid-token"
    );

    assert.equal(result.success, true, result.success ? "" : result.error);
  });

  it("consumes the token exactly once", async () => {
    provider.resetTokens.set("valid-token", EMAIL);
    const { resetPasswordAction } = await loadAction();
    const input = { password: "NewPassword1", confirmPassword: "NewPassword1" };

    const first = await resetPasswordAction(input, "valid-token");
    const replay = await resetPasswordAction(input, "valid-token");

    assert.equal(first.success, true);
    assert.equal(replay.success, false, "a replayed token must not reset the password again");
  });

  it("reports an expired or unknown token as an expired link", async () => {
    const { resetPasswordAction } = await loadAction();

    const result = await resetPasswordAction(
      { password: "NewPassword1", confirmPassword: "NewPassword1" },
      "stale-token"
    );

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /expired/i);
  });

  it("reports a missing token as an expired link rather than a crash", async () => {
    const { resetPasswordAction } = await loadAction();

    for (const missing of [undefined, null, "", "   "]) {
      const result = await resetPasswordAction(
        { password: "NewPassword1", confirmPassword: "NewPassword1" },
        missing
      );
      assert.equal(result.success, false);
      assert.match(result.success ? "" : result.error, /expired|request a new one/i);
    }
  });

  it("rejects a short password before spending the token", async () => {
    provider.resetTokens.set("valid-token", EMAIL);
    const { resetPasswordAction } = await loadAction();

    const result = await resetPasswordAction(
      { password: "abc", confirmPassword: "abc" },
      "valid-token"
    );

    assert.equal(result.success, false);
    assert.ok(result.fieldErrors?.password);
    assert.equal(
      provider.resetTokens.has("valid-token"),
      true,
      "the token survives a validation failure so the person can correct the form"
    );
  });

  it("rejects a confirmation mismatch", async () => {
    provider.resetTokens.set("valid-token", EMAIL);
    const { resetPasswordAction } = await loadAction();

    const result = await resetPasswordAction(
      { password: "NewPassword1", confirmPassword: "Different1" },
      "valid-token"
    );

    assert.equal(result.success, false);
    assert.deepEqual(provider.events, []);
  });
});

describe("resendVerificationAction — link first, code as the fallback", () => {
  it("sends a verification LINK when the branch has a custom email provider", async () => {
    provider.verificationLinksEnabled = true;
    const { resendVerificationAction } = await loadAction();

    const result = await resendVerificationAction(EMAIL);

    assert.equal(result.success, true);
    assert.equal(result.success && result.data.method, "link");
    assert.ok(provider.events.includes("sendVerificationEmail"));
    assert.ok(
      !provider.events.includes("sendVerificationCode"),
      "no code is sent when the link worked"
    );
  });

  it("falls back to a verification CODE when links are not enabled", async () => {
    // The shared email provider — available immediately, before anybody
    // configures a custom one — supports codes but not links.
    provider.verificationLinksEnabled = false;
    const { resendVerificationAction } = await loadAction();

    const result = await resendVerificationAction(EMAIL);

    assert.equal(result.success, true, result.success ? "" : result.error);
    assert.equal(result.success && result.data.method, "code");
    assert.deepEqual(provider.events, ["sendVerificationEmail", "sendVerificationCode"]);
  });

  it("tells the caller which method succeeded so the form can adapt", async () => {
    const { resendVerificationAction } = await loadAction();

    provider.verificationLinksEnabled = false;
    const viaCode = await resendVerificationAction(EMAIL);
    provider.reset();
    provider.verificationLinksEnabled = true;
    const viaLink = await resendVerificationAction(EMAIL);

    assert.equal(viaCode.success && viaCode.data.method, "code");
    assert.equal(viaLink.success && viaLink.data.method, "link");
  });

  it("surfaces a genuine failure instead of silently falling back", async () => {
    // A rate limit is not "links are disabled" — reporting it as success would
    // send somebody to wait for mail that was never queued.
    provider.failWith.sendVerificationEmail = {
      code: "rate_limited",
      message: "Too many requests. Please wait a moment and try again.",
      status: 429,
    };
    const { resendVerificationAction } = await loadAction();

    const result = await resendVerificationAction(EMAIL);

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /too many requests/i);
    assert.ok(!provider.events.includes("sendVerificationCode"));
  });

  it("reports a failure when the code path also fails", async () => {
    provider.verificationLinksEnabled = false;
    provider.failWith.sendVerificationCode = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { resendVerificationAction } = await loadAction();

    const result = await resendVerificationAction(EMAIL);

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /couldn't reach/i);
  });

  it("rejects a malformed address without contacting the provider", async () => {
    const { resendVerificationAction } = await loadAction();

    const result = await resendVerificationAction("not-an-email");

    assert.equal(result.success, false);
    assert.deepEqual(provider.events, []);
  });
});

describe("verifyEmailWithCodeAction", () => {
  it("verifies a correct code and routes a signed-in person onward", async () => {
    provider.verificationCodes.set(EMAIL, "424242");
    const { verifyEmailWithCodeAction } = await loadAction();

    const result = await verifyEmailWithCodeAction({ email: EMAIL, code: "424242" });

    assert.equal(result.success, true, result.success ? "" : result.error);
    // Verification auto-signs-in by provider default, and this identity has no
    // application row yet — so onboarding is the next step, not the dashboard.
    assert.equal(result.success && result.data.redirectTo, "/complete-profile");
  });

  it("routes a verified, onboarded seller to the seller dashboard", async () => {
    store.tables.users.set("app-user", {
      id: "app-user",
      email: EMAIL,
      authUserId: "neon-auth-user-9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d",
      phone: null,
      role: "SELLER",
      isActive: true,
      isBanned: false,
      emailVerified: true,
    });
    store.tables.profiles.set("app-user", {
      userId: "app-user",
      fullName: "Emmanuel Yegon",
      avatarUrl: null,
      county: "Uasin Gishu",
      onboarded: true,
    });
    store.tables.sellers.set("app-user", {
      userId: "app-user",
      businessName: "Yegon Electronics",
      slug: "yegon-electronics-ab12c",
      county: "Uasin Gishu",
    });
    provider.verificationCodes.set(EMAIL, "424242");
    const { verifyEmailWithCodeAction } = await loadAction();

    const result = await verifyEmailWithCodeAction({ email: EMAIL, code: "424242" });

    assert.equal(result.success && result.data.redirectTo, "/dashboard/seller");
  });

  it("sends somebody to sign in when verification did not establish a session", async () => {
    // Auto-sign-in is the provider default but it is a SETTING. With it off, a
    // successful verification leaves the person signed out, and the action must
    // answer "success, now sign in" rather than inventing a destination.
    provider.autoSignInOnVerification = false;
    provider.verificationCodes.set(EMAIL, "424242");
    const { verifyEmailWithCodeAction } = await loadAction();

    const result = await verifyEmailWithCodeAction({ email: EMAIL, code: "424242" });

    assert.equal(result.success, true, result.success ? "" : result.error);
    assert.equal(result.success && result.data.redirectTo, "/login");
  });

  it("rejects a wrong code", async () => {
    provider.verificationCodes.set(EMAIL, "424242");
    const { verifyEmailWithCodeAction } = await loadAction();

    const result = await verifyEmailWithCodeAction({ email: EMAIL, code: "000000" });

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /code isn't valid/i);
  });

  it("rejects a code that is not six to eight digits", async () => {
    const { verifyEmailWithCodeAction } = await loadAction();

    for (const code of ["12345", "abcdef", "1234567890", ""]) {
      const result = await verifyEmailWithCodeAction({ email: EMAIL, code });
      assert.equal(result.success, false, `code ${JSON.stringify(code)} should be rejected`);
      assert.ok(result.fieldErrors?.code);
    }
    assert.deepEqual(provider.events, []);
  });
});

describe("signInWithGoogleAction", () => {
  it("redirects the browser to the provider's authorize URL", async () => {
    const { signInWithGoogleAction } = await loadAction();

    await assert.rejects(
      () => signInWithGoogleAction("/complete-profile"),
      (error: unknown) =>
        error instanceof RedirectSignal &&
        error.destination === "https://accounts.google.com/o/oauth2/v2/auth?state=x"
    );
  });

  it("passes an absolute callbackURL on our own origin", async () => {
    const { signInWithGoogleAction } = await loadAction();

    await assert.rejects(() => signInWithGoogleAction("/dashboard/buyer"));

    const [args] = provider.calls.signInWithGoogle![0]!;
    const { callbackURL } = args as { callbackURL: string };

    // Must be absolute and on a domain the branch trusts, or the service refuses
    // to return the browser to us after the handshake.
    assert.equal(callbackURL, "https://malihub.test/dashboard/buyer");
  });

  it("falls back to /complete-profile for an unsafe `next`", async () => {
    const { signInWithGoogleAction } = await loadAction();

    await assert.rejects(() => signInWithGoogleAction("//evil.example/steal"));

    const [args] = provider.calls.signInWithGoogle![0]!;
    assert.equal((args as { callbackURL: string }).callbackURL, "https://malihub.test/complete-profile");
  });

  it("redirects to /login with an explanation when the provider cannot start the flow", async () => {
    provider.socialUrl = null;
    const { signInWithGoogleAction } = await loadAction();

    await assert.rejects(
      () => signInWithGoogleAction(),
      (error: unknown) =>
        error instanceof RedirectSignal && error.destination.startsWith("/login?error=")
    );
  });
});

describe("signOutAction", () => {
  it("clears the provider session and returns to the landing page", async () => {
    const { signOutAction } = await loadAction();

    await assert.rejects(
      () => signOutAction(),
      (error: unknown) => error instanceof RedirectSignal && error.destination === "/"
    );
    assert.ok(provider.events.includes("signOut"));
    assert.equal(provider.session, null);
  });

  it("still navigates away when the provider cannot confirm the clear", async () => {
    provider.failWith.signOut = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { signOutAction } = await loadAction();

    // Trapping somebody on a page they were trying to leave because the auth
    // service hiccuped would be worse than the imperfect sign-out.
    await assert.rejects(
      () => signOutAction(),
      (error: unknown) => error instanceof RedirectSignal && error.destination === "/"
    );
  });
});
