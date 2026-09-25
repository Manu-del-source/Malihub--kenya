import { mock } from "node:test";
import type { AuthFailure, AuthIdentity } from "@/lib/auth/types";
import type { FakeStore } from "@/services/__tests__/fake-account-store";

/**
 * Test seam for the authentication Server Actions.
 *
 * `src/lib/auth/neon.ts` is the ONLY module in the application that imports
 * `@neondatabase/auth`. Mocking it — rather than the SDK, and rather than
 * `@/lib/auth` — is what makes these tests worth reading:
 *
 *   mocked   `@/lib/auth/neon`   (the provider boundary)
 *   mocked   `@/lib/prisma`      (an in-memory store with real Postgres semantics)
 *   REAL     `@/lib/auth/session`, `identity`, `errors`, `config`, `redirects`
 *   REAL     `@/services/auth-service`, `@/services/account-provisioning`
 *   REAL     `src/app/(auth)/actions.ts`
 *
 * So the guards, the error normalization, the identity mapping, the provisioning
 * transaction and the actions themselves all execute for real. Only "what did the
 * auth service say?" and "what is in the database?" are substituted.
 *
 * `mock.module` must run before the module under test is imported, which is why
 * {@link installAuthActionMocks} is called at the top level of a test file and
 * the actions are then loaded with a dynamic `await import(...)`.
 */

export const AUTH_USER_ID = "neon-auth-user-9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d";
export const APP_USER_ID = "11111111-2222-3333-4444-555555555555";

export function makeIdentity(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return {
    authUserId: AUTH_USER_ID,
    email: "emmanuel@example.com",
    name: "Emmanuel Yegon",
    emailVerified: true,
    image: null,
    sessionId: "session-1",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

export type ProviderFixture = {
  /** Every provider call, in order (e.g. "signIn", "signOut"). */
  events: string[];
  /** Arguments of each call, keyed by operation name. */
  calls: Record<string, unknown[][]>;
  /** What `providerSignIn` / `providerSignUp` return. */
  identity: AuthIdentity | null;
  /** Returned instead of an identity when `identity` is null. */
  failure: AuthFailure | null;
  /** What `readAuthSession` reports — drives every guard. */
  session: AuthIdentity | null;
  sessionFailure: AuthFailure | null;
  /** Mirrors the branch's email configuration; see resendVerificationAction. */
  verificationLinksEnabled: boolean;
  /**
   * Whether verifying a code also establishes a session. Auto-sign-in is the
   * provider DEFAULT, but it is a setting — so the action must cope with both,
   * and a test needs to be able to select the other one.
   */
  autoSignInOnVerification: boolean;
  /** Reset tokens the "service" has issued, token → email. */
  resetTokens: Map<string, string>;
  /** Verification codes the "service" has issued, email → code. */
  verificationCodes: Map<string, string>;
  /** URL `providerSignInWithGoogle` hands back. */
  socialUrl: string | null;
  /** Forces an operation to fail with a specific provider error. */
  failWith: Partial<Record<string, AuthFailure>>;
  reset(): void;
};

/** Thrown by the mocked `redirect()` so tests can assert on navigation. */
export class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`NEXT_REDIRECT: ${destination}`);
    this.name = "NEXT_REDIRECT";
  }
}

export function installAuthActionMocks(store: FakeStore): ProviderFixture {
  const fixture: ProviderFixture = {
    events: [],
    calls: {},
    identity: makeIdentity(),
    failure: null,
    session: makeIdentity(),
    sessionFailure: null,
    verificationLinksEnabled: false,
    autoSignInOnVerification: true,
    resetTokens: new Map(),
    verificationCodes: new Map(),
    socialUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=x",
    failWith: {},
    reset() {
      this.events.length = 0;
      this.calls = {};
      this.identity = makeIdentity();
      this.failure = null;
      this.session = makeIdentity();
      this.sessionFailure = null;
      this.verificationLinksEnabled = false;
      this.autoSignInOnVerification = true;
      this.resetTokens.clear();
      this.verificationCodes.clear();
      this.socialUrl = "https://accounts.google.com/o/oauth2/v2/auth?state=x";
      this.failWith = {};
    },
  };

  const record = (name: string, args: unknown[]) => {
    fixture.events.push(name);
    (fixture.calls[name] ??= []).push(args);
  };

  const ok = <T>(data: T) => ({ data, failure: null });
  /**
   * Precedence for a failed call: a per-operation `failWith` entry, then the
   * global `failure` override, then the operation's own sensible default. The
   * global override is what lets a test say "the auth service is down" without
   * repeating the failure shape at every call site.
   */
  const bad = (name: string, fallback: AuthFailure) => ({
    data: null,
    failure: fixture.failWith[name] ?? fixture.failure ?? fallback,
  });

  const notFound = (message: string, code: AuthFailure["code"]) => ({
    data: null,
    failure: { code, message } satisfies AuthFailure,
  });

  mock.module("@/lib/auth/neon", {
    namedExports: {
      async providerSignUp(input: { email: string; password: string; name: string }) {
        record("signUp", [input]);
        if (fixture.identity) return ok(fixture.identity);
        return bad("signUp", notFound("An account with that email already exists.", "email_taken").failure!);
      },
      async providerSignIn(input: { email: string; password: string }) {
        record("signIn", [input]);
        if (fixture.identity) return ok(fixture.identity);
        return bad(
          "signIn",
          notFound("That email or password doesn't look right.", "invalid_credentials").failure!
        );
      },
      async providerSignInWithGoogle(input: { callbackURL: string }) {
        record("signInWithGoogle", [input]);
        if (fixture.failWith.signInWithGoogle) return bad("signInWithGoogle", fixture.failWith.signInWithGoogle);
        if (!fixture.socialUrl) {
          return notFound("Couldn't start Google sign-in.", "unknown");
        }
        return ok({ url: fixture.socialUrl });
      },
      async providerSignOut() {
        record("signOut", []);
        if (fixture.failWith.signOut) return bad("signOut", fixture.failWith.signOut);
        fixture.session = null;
        return ok(true as const);
      },
      async providerRequestPasswordReset(input: { email: string; redirectTo: string }) {
        record("requestPasswordReset", [input]);
        if (fixture.failWith.requestPasswordReset ?? fixture.failure) {
          return bad("requestPasswordReset", {
            code: "auth_unavailable",
            message: "We couldn't reach the sign-in service. Please try again in a moment.",
          });
        }
        // Mirrors the real service: a token is issued for a known address, and
        // the response is identical either way (no account enumeration).
        const token = `reset-token-${input.email}`;
        fixture.resetTokens.set(token, input.email);
        return ok(true as const);
      },
      async providerResetPassword(input: { newPassword: string; token: string }) {
        record("resetPassword", [input]);
        if (fixture.failWith.resetPassword) return bad("resetPassword", fixture.failWith.resetPassword);
        if (!fixture.resetTokens.has(input.token)) {
          return notFound(
            "Your password reset link has expired. Please request a new one.",
            "invalid_token"
          );
        }
        fixture.resetTokens.delete(input.token); // one-time
        return ok(true as const);
      },
      async providerSendVerificationEmail(input: { email: string; callbackURL?: string }) {
        record("sendVerificationEmail", [input]);
        if (fixture.failWith.sendVerificationEmail) {
          return bad("sendVerificationEmail", fixture.failWith.sendVerificationEmail);
        }
        if (!fixture.verificationLinksEnabled) {
          // Exactly what the shared-provider branch answers. `./errors` maps
          // this onto `capability_not_enabled`.
          return {
            data: null,
            failure: {
              code: "capability_not_enabled" as const,
              message: "Verification email isn't enabled",
            },
          };
        }
        return ok(true as const);
      },
      async providerSendVerificationCode(input: { email: string }) {
        record("sendVerificationCode", [input]);
        if (fixture.failWith.sendVerificationCode) {
          return bad("sendVerificationCode", fixture.failWith.sendVerificationCode);
        }
        fixture.verificationCodes.set(input.email.toLowerCase(), "424242");
        return ok(true as const);
      },
      async providerVerifyEmailWithCode(input: { email: string; otp: string }) {
        record("verifyEmailWithCode", [input]);
        if (fixture.failWith.verifyEmailWithCode) {
          return bad("verifyEmailWithCode", fixture.failWith.verifyEmailWithCode);
        }
        if (fixture.verificationCodes.get(input.email.toLowerCase()) !== input.otp) {
          return notFound("That code isn't valid.", "invalid_token");
        }
        fixture.verificationCodes.delete(input.email.toLowerCase());
        if (fixture.autoSignInOnVerification) {
          // Auto-sign-in is the provider default on successful verification,
          // which is why the action re-reads the session afterwards instead of
          // assuming the person is still signed out.
          fixture.session = makeIdentity({ email: input.email, emailVerified: true });
        } else {
          fixture.session = null;
        }
        return ok(true as const);
      },
      async readAuthSession() {
        record("readAuthSession", []);
        if (fixture.session) return { identity: fixture.session, failure: null };
        return { identity: null, failure: fixture.sessionFailure };
      },
      createNeonAuthMiddleware() {
        return null;
      },
      toAuthIdentity(payload: unknown) {
        return payload;
      },
    },
  });

  mock.module("@/lib/prisma", { namedExports: { prisma: store } });
  mock.module("server-only", { namedExports: {} });
  mock.module("next/navigation", {
    namedExports: {
      redirect: (destination: string) => {
        throw new RedirectSignal(destination);
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    },
  });
  mock.module("next/headers", {
    namedExports: {
      headers: async () => new Map([["host", "malihub.test"]]),
      cookies: async () => new Map(),
    },
  });

  return fixture;
}
