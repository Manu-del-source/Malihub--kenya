import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * A minimal stand-in for the Managed Better Auth REST service
 * (`NEON_AUTH_BASE_URL`) used by the auth test suites.
 *
 * Why a mock upstream instead of assertions against a live Neon branch:
 *  - a test suite must never be pointed at production identity data, and
 *  - the sandbox has no network route to `*.neonauth.*.neon.tech`.
 *
 * What is NOT mocked: every `@neondatabase/auth` code path under test — the
 * proxy handler, session-cookie minting/validation, `processAuthMiddleware`,
 * and the server-side session API — runs for real. Only the HTTP service on the
 * other end of `baseUrl` is local. That is what makes these tests worth having:
 * they exercise the real SDK against the real wire protocol rather than
 * asserting against a hand-written fake of our own adapter.
 *
 * Endpoints mirror the Better Auth paths the SDK's `API_ENDPOINTS` table
 * declares (verified against `@neondatabase/auth@0.5.0-beta`):
 *   POST /sign-up/email                  POST /sign-in/email
 *   POST /sign-in/social                 GET  /get-session
 *   POST /sign-out                       POST /request-password-reset
 *   POST /reset-password                 POST /send-verification-email
 *   POST /email-otp/send-verification-otp
 *   POST /email-otp/verify-email
 */

const SESSION_COOKIE = "__Secure-neon-auth.session_token";

export type MockUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  image: string | null;
};

/** Knobs a test can turn to reproduce a specific upstream configuration. */
export type MockAuthUpstreamControls = {
  /**
   * Verification LINKS require a custom email provider on the Neon branch.
   * When false (the shared-provider default) `/send-verification-email`
   * answers exactly what the real service answers, which is the signal
   * `resendVerificationAction` uses to fall back to a CODE.
   */
  verificationLinksEnabled: boolean;
  /** Makes every endpoint answer 502, simulating an auth-service outage. */
  outage: boolean;
};

export type MockAuthUpstream = {
  baseUrl: string;
  controls: MockAuthUpstreamControls;
  /** Every request the SDK made, in order (e.g. "POST /sign-in/email"). */
  requests: string[];
  countOf(methodAndPath: string): number;
  createdUsers(): MockUser[];
  findUser(email: string): MockUser | undefined;
  /** The most recent reset token issued for an email, if any. */
  resetTokenFor(email: string): string | undefined;
  /** The most recent verification code issued for an email, if any. */
  verificationCodeFor(email: string): string | undefined;
  /**
   * Empties every account, session, token and code.
   *
   * One upstream serves a whole suite, so without this the second test to
   * register `emmanuel@example.com` would get "User already exists" and appear
   * to have broken cookie handling when nothing of the sort happened.
   */
  reset(): void;
  close(): Promise<void>;
};

function betterAuthId(): string {
  // Better Auth's default ids are 32-character random strings (not UUIDs).
  return randomBytes(24).toString("base64url").slice(0, 32);
}

function sessionPayload(user: MockUser) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    session: {
      id: betterAuthId(),
      token: betterAuthId(),
      userId: user.id,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ipAddress: "127.0.0.1",
      userAgent: "mock-upstream-test",
    },
    user,
  };
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on("error", reject);
  });
}

function sessionCookieHeader(token: string, maxAge?: number): string {
  const base = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
  return maxAge === undefined ? base : `${base}; Max-Age=${maxAge}`;
}

function json(response: ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  const headers: Record<string, string | string[]> = { "content-type": "application/json" };
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

/** Starts the mock upstream on an ephemeral localhost port. */
export async function startMockAuthUpstream(): Promise<MockAuthUpstream> {
  const users = new Map<string, { user: MockUser; password: string }>();
  const tokens = new Map<string, string>(); // session token → user id
  const resetTokens = new Map<string, string>(); // token → user id
  const verificationCodes = new Map<string, string>(); // user id → 6-digit code
  const requests: string[] = [];
  const controls: MockAuthUpstreamControls = {
    verificationLinksEnabled: false,
    outage: false,
  };

  const byEmail = (email: string) =>
    [...users.values()].find((entry) => entry.user.email === email.toLowerCase());

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const route = `${request.method ?? "GET"} ${url.pathname}`;
      requests.push(route);

      if (controls.outage) {
        return json(response, 502, { message: "Bad Gateway: upstream auth service unreachable" });
      }

      const cookieHeader = request.headers.cookie ?? "";
      const tokenMatch = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader);
      const token = tokenMatch?.[1];
      const currentUserId = token ? tokens.get(token) : undefined;
      const currentUser = currentUserId ? users.get(currentUserId)?.user : undefined;

      if (route === "POST /sign-up/email") {
        const body = await readJson(request);
        const email = String(body.email ?? "").toLowerCase();
        if (!email || typeof body.password !== "string") {
          return json(response, 400, { message: "Email and password are required" });
        }
        if (byEmail(email)) {
          return json(response, 422, { message: "User already exists" });
        }
        const user: MockUser = {
          id: betterAuthId(),
          name: typeof body.name === "string" && body.name ? body.name : email.split("@")[0]!,
          email,
          emailVerified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          image: null,
        };
        users.set(user.id, { user, password: body.password });
        const newToken = betterAuthId();
        tokens.set(newToken, user.id);
        return json(response, 200, { token: newToken, user }, [sessionCookieHeader(newToken)]);
      }

      if (route === "POST /sign-in/email") {
        const body = await readJson(request);
        const email = String(body.email ?? "").toLowerCase();
        const entry = byEmail(email);
        if (!entry || entry.password !== body.password) {
          return json(response, 401, { message: "Invalid email or password" });
        }
        const newToken = betterAuthId();
        tokens.set(newToken, entry.user.id);
        return json(response, 200, { token: newToken, user: entry.user }, [
          sessionCookieHeader(newToken),
        ]);
      }

      if (route === "POST /sign-in/social") {
        const body = await readJson(request);
        const provider = String(body.provider ?? "");
        const callbackURL = typeof body.callbackURL === "string" ? body.callbackURL : "";
        if (provider !== "google") {
          return json(response, 400, { message: `Unsupported provider: ${provider}` });
        }
        // With `disableRedirect: true` the service returns the authorize URL in
        // the body instead of answering with a Location header — that is what
        // makes the flow usable from a Server Action.
        if (body.disableRedirect === true) {
          return json(response, 200, {
            url: `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(
              callbackURL
            )}`,
            redirect: false,
          });
        }
        response.writeHead(302, { location: "https://accounts.google.com/o/oauth2/v2/auth" });
        return response.end();
      }

      if (route === "GET /get-session") {
        if (!currentUser) return json(response, 200, null);
        return json(response, 200, sessionPayload(currentUser));
      }

      if (route === "POST /sign-out") {
        if (token) tokens.delete(token);
        return json(response, 200, { success: true }, [sessionCookieHeader("", 0)]);
      }

      if (route === "POST /request-password-reset") {
        const body = await readJson(request);
        const email = String(body.email ?? "").toLowerCase();
        const entry = byEmail(email);
        // Deliberately answers identically whether or not the address exists —
        // the property `forgotPasswordAction` relies on to avoid enumeration.
        if (entry) {
          const resetToken = randomUUID();
          resetTokens.set(resetToken, entry.user.id);
        }
        return json(response, 200, { success: true });
      }

      if (route === "POST /reset-password") {
        const body = await readJson(request);
        const supplied = String(body.token ?? "");
        const userId = resetTokens.get(supplied);
        if (!userId) {
          return json(response, 400, { message: "Invalid or expired reset token" });
        }
        if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
          return json(response, 400, { message: "Password is too short" });
        }
        const entry = users.get(userId);
        if (!entry) return json(response, 400, { message: "Invalid or expired reset token" });
        entry.password = body.newPassword;
        resetTokens.delete(supplied); // one-time
        return json(response, 200, { success: true });
      }

      if (route === "POST /send-verification-email") {
        const body = await readJson(request);
        const email = String(body.email ?? "").toLowerCase();
        if (!byEmail(email)) {
          // Still a success-shaped answer: revealing which addresses exist is
          // exactly what the real service avoids.
          return json(response, 200, { success: true });
        }
        if (!controls.verificationLinksEnabled) {
          return json(response, 400, {
            message: "Verification email isn't enabled",
            code: "VERIFICATION_EMAIL_NOT_ENABLED",
          });
        }
        return json(response, 200, { success: true });
      }

      if (route === "POST /email-otp/send-verification-otp") {
        const body = await readJson(request);
        const email = String(body.email ?? "").toLowerCase();
        const entry = byEmail(email);
        if (entry) {
          verificationCodes.set(entry.user.id, String(randomBytes(3).readUIntBE(0, 3)).padStart(6, "0").slice(-6));
        }
        return json(response, 200, { success: true });
      }

      if (route === "POST /email-otp/verify-email") {
        const body = await readJson(request);
        const email = String(body.email ?? "").toLowerCase();
        const entry = byEmail(email);
        if (!entry || verificationCodes.get(entry.user.id) !== String(body.otp ?? "")) {
          return json(response, 400, { message: "Invalid or expired verification code" });
        }
        entry.user.emailVerified = true;
        verificationCodes.delete(entry.user.id);
        // Auto-sign-in is the provider default on successful verification, so
        // the mock mints a session — which is why the action re-reads state
        // afterwards instead of assuming the person is still signed out.
        const newToken = betterAuthId();
        tokens.set(newToken, entry.user.id);
        return json(response, 200, { token: newToken, user: entry.user }, [
          sessionCookieHeader(newToken),
        ]);
      }

      json(response, 404, { message: `Unhandled mock route: ${route}` });
    })().catch((error: unknown) => {
      json(response, 500, { message: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    controls,
    requests,
    countOf: (methodAndPath: string) =>
      requests.filter((entry) => entry === methodAndPath).length,
    createdUsers: () => [...users.values()].map((entry) => entry.user),
    findUser: (email: string) => byEmail(email)?.user,
    resetTokenFor: (email: string) => {
      const entry = byEmail(email);
      if (!entry) return undefined;
      for (const [issuedToken, userId] of resetTokens) {
        if (userId === entry.user.id) return issuedToken;
      }
      return undefined;
    },
    verificationCodeFor: (email: string) => {
      const entry = byEmail(email);
      return entry ? verificationCodes.get(entry.user.id) : undefined;
    },
    reset: () => {
      users.clear();
      tokens.clear();
      resetTokens.clear();
      verificationCodes.clear();
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** A base URL that refuses connections — used for the failure-handling tests. */
export const UNREACHABLE_NEON_AUTH_BASE_URL = "http://127.0.0.1:1";
