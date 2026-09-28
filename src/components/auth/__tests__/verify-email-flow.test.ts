import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeAccountStore,
  type FakeStore,
} from "@/services/__tests__/fake-account-store";
import {
  installAuthActionMocks,
  type ProviderFixture,
} from "@/lib/auth/__tests__/provider-mock";

/**
 * Regression tests for the verify-email panel.
 *
 * The bug: "Didn't get a link? Enter a code instead" called the link-first
 * `resendVerificationAction`. On a branch with verification links enabled that
 * sent ANOTHER LINK, reported `method: "link"`, and the panel deliberately stayed
 * in link mode — so the button did nothing visible and no code was ever issued.
 *
 * The panel's decisions live in `verify-email-flow.ts`; these tests run them
 * against the REAL Server Actions and the mocked provider boundary, so what is
 * asserted is what the provider would actually have been asked to send.
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

describe("verify-email panel — \"Enter a code instead\"", () => {
  it("requests a code, never a link, and switches to code mode (original bug)", async () => {
    provider.verificationLinksEnabled = true; // the configuration that exposed the bug
    const { sendVerificationCodeAction } = await loadAction();
    const { runSendCode, COOLDOWN_SECONDS } = await import(
      "@/components/auth/verify-email-flow"
    );

    const outcome = await runSendCode(sendVerificationCodeAction, EMAIL);

    assert.deepEqual(provider.events, ["sendVerificationCode"]);
    assert.ok(
      !provider.events.includes("sendVerificationEmail"),
      "the verification-link endpoint must not be called first"
    );
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.mode, "code");
    assert.equal(outcome.ok && outcome.cooldown, COOLDOWN_SECONDS);
  });

  it("stays in link mode and surfaces a safe error when the code cannot be sent", async () => {
    provider.verificationLinksEnabled = true;
    provider.failWith.sendVerificationCode = {
      code: "auth_unavailable",
      message: "We couldn't reach the sign-in service. Please try again in a moment.",
      status: 502,
    };
    const { sendVerificationCodeAction } = await loadAction();
    const { runSendCode } = await import("@/components/auth/verify-email-flow");

    const outcome = await runSendCode(sendVerificationCodeAction, EMAIL);

    // No `mode` on a failure: the panel has nothing to switch to.
    assert.equal(outcome.ok, false);
    assert.match(!outcome.ok ? outcome.error : "", /couldn't reach/i);
    assert.ok(!("mode" in outcome));
  });

  it("makes no cooldown claim when nothing was sent", async () => {
    provider.failWith.sendVerificationCode = {
      code: "rate_limited",
      message: "Too many requests. Please wait a moment and try again.",
      status: 429,
    };
    const { sendVerificationCodeAction } = await loadAction();
    const { runSendCode } = await import("@/components/auth/verify-email-flow");

    const outcome = await runSendCode(sendVerificationCodeAction, EMAIL);

    assert.equal(outcome.ok, false);
    assert.ok(!("cooldown" in outcome));
  });
});

describe("verify-email panel — \"Resend verification email\"", () => {
  it("remains a link operation and stays in link mode", async () => {
    provider.verificationLinksEnabled = true;
    const { resendVerificationAction } = await loadAction();
    const { runResendLink } = await import("@/components/auth/verify-email-flow");

    const outcome = await runResendLink(resendVerificationAction, EMAIL);

    assert.deepEqual(provider.events, ["sendVerificationEmail"]);
    assert.equal(outcome.ok && outcome.mode, "link");
  });

  it("switches to code mode only when the branch has links disabled and a code really went out", async () => {
    provider.verificationLinksEnabled = false;
    const { resendVerificationAction } = await loadAction();
    const { runResendLink } = await import("@/components/auth/verify-email-flow");

    const outcome = await runResendLink(resendVerificationAction, EMAIL);

    assert.deepEqual(provider.events, ["sendVerificationEmail", "sendVerificationCode"]);
    assert.equal(outcome.ok && outcome.mode, "code");
  });
});

describe("verify-email panel — full path: enter a code, then verify it", () => {
  it("issues a code, accepts it, and routes a new account to /complete-profile", async () => {
    provider.verificationLinksEnabled = true;
    const { sendVerificationCodeAction, verifyEmailWithCodeAction } = await loadAction();
    const { runSendCode } = await import("@/components/auth/verify-email-flow");

    const sent = await runSendCode(sendVerificationCodeAction, EMAIL);
    assert.equal(sent.ok, true);

    const code = provider.verificationCodes.get(EMAIL);
    assert.ok(code, "a code was issued by the provider");

    const verified = await verifyEmailWithCodeAction({ email: EMAIL, code: code! });

    assert.equal(verified.success, true, verified.success ? "" : verified.error);
    assert.equal(verified.success && verified.data.redirectTo, "/complete-profile");
  });
});
