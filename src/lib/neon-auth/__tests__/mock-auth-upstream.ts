import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * A minimal stand-in for the Managed Better Auth REST service
 * (`NEON_AUTH_BASE_URL`) used by the POC tests.
 *
 * Why a mock upstream instead of assertions against the live Neon branch:
 *  - the POC must never be pointed at production data from a test suite, and
 *  - the sandbox that produced this evaluation has no network route to
 *    `*.neonauth.*.neon.tech`.
 *
 * What is NOT mocked: every `@neondatabase/auth` code path under test — the
 * proxy handler, session-cookie minting/validation (HS256 `jose`), the
 * middleware, and the server-side session API — runs for real. Only the HTTP
 * service on the other end of `baseUrl` is local.
 *
 * Endpoints mirror the Better Auth API surface the SDK calls:
 *   POST /sign-up/email, POST /sign-in/email, GET /get-session, POST /sign-out.
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

export type MockAuthUpstream = {
  baseUrl: string;
  /** Every request the SDK made, in order (e.g. "POST /sign-in/email"). */
  requests: string[];
  countOf(methodAndPath: string): number;
  createdUsers(): MockUser[];
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
  const tokens = new Map<string, string>(); // token → user id
  const requests: string[] = [];

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const route = `${request.method ?? "GET"} ${url.pathname}`;
      requests.push(route);

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
        if ([...users.values()].some((entry) => entry.user.email === email)) {
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
        const entry = [...users.values()].find((candidate) => candidate.user.email === email);
        if (!entry || entry.password !== body.password) {
          return json(response, 401, { message: "Invalid email or password" });
        }
        const newToken = betterAuthId();
        tokens.set(newToken, entry.user.id);
        return json(response, 200, { token: newToken, user: entry.user }, [
          sessionCookieHeader(newToken),
        ]);
      }

      if (route === "GET /get-session") {
        if (!currentUser) return json(response, 200, null);
        return json(response, 200, sessionPayload(currentUser));
      }

      if (route === "POST /sign-out") {
        if (token) tokens.delete(token);
        return json(response, 200, { success: true }, [sessionCookieHeader("", 0)]);
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
    requests,
    countOf: (methodAndPath: string) =>
      requests.filter((entry) => entry === methodAndPath).length,
    createdUsers: () => [...users.values()].map((entry) => entry.user),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** A base URL that refuses connections — used for the failure-handling tests. */
export const UNREACHABLE_NEON_AUTH_BASE_URL = "http://127.0.0.1:1";
