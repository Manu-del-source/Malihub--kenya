/**
 * Defensive mapping of whatever Managed Better Auth returns from
 * `auth.getSession()` (or `/get-session`) into the flat view model the POC
 * renders.
 *
 * Two reasons this is a separate, pure module:
 *  - the POC must survive a malformed/partial upstream payload without crashing
 *    a page (the "session retrieval failure" case), and
 *  - it is the one piece of POC presentation logic worth unit-testing without
 *    standing up the SDK.
 *
 * `getSession()` returns `{ session: null, user: null }` when nobody is signed
 * in, so "unauthenticated" is a first-class result rather than an error.
 */

export type NeonSessionView = {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  name: string | null;
  emailVerified: boolean | null;
  image: string | null;
  sessionId: string | null;
  expiresAt: string | null;
  createdAt: string | null;
};

export const NEON_SESSION_ANONYMOUS: NeonSessionView = {
  authenticated: false,
  userId: null,
  email: null,
  name: null,
  emailVerified: null,
  image: null,
  sessionId: null,
  expiresAt: null,
  createdAt: null,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return stringValue(value);
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function toNeonSessionView(payload: unknown): NeonSessionView {
  const payloadRecord = record(payload);
  const user = record(payloadRecord?.user);
  const session = record(payloadRecord?.session);

  // Better Auth returns `{ session: null, user: null }` for signed-out callers.
  if (!user?.id) return NEON_SESSION_ANONYMOUS;

  return {
    authenticated: true,
    userId: stringValue(user.id),
    email: stringValue(user.email),
    name: stringValue(user.name),
    emailVerified: booleanValue(user.emailVerified),
    image: stringValue(user.image),
    sessionId: stringValue(session?.id),
    expiresAt: dateValue(session?.expiresAt),
    createdAt: dateValue(session?.createdAt),
  };
}
