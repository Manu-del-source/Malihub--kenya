import "server-only";

import { prisma } from "@/lib/prisma";
import type { AuthIdentity } from "@/lib/auth/types";

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/** Pure policy helper, exported so timeout boundaries can be tested. */
export function isSessionIdleExpired(
  lastActivityAt: Date,
  now: Date,
  timeoutMs = SESSION_IDLE_TIMEOUT_MS
): boolean {
  return now.getTime() - lastActivityAt.getTime() >= timeoutMs;
}

/**
 * Enforces an inactivity limit for one provider session.
 *
 * Session IDs are opaque provider identifiers. We bind each ID to its provider
 * user ID, reject missing/expired provider metadata, and never refresh an
 * already-idle session. Activity writes are throttled to one per five minutes.
 */
export async function enforceSessionIdleTimeout(identity: AuthIdentity): Promise<boolean> {
  const sessionId = identity.sessionId?.trim();
  const authUserId = identity.authUserId?.trim();
  const expiresAt = identity.expiresAt ? new Date(identity.expiresAt) : null;
  const now = new Date();

  if (
    !sessionId ||
    !authUserId ||
    !expiresAt ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= now.getTime()
  ) {
    return false;
  }

  let activity = await prisma.authSessionActivity.findUnique({
    where: { sessionId },
  });

  if (!activity) {
    try {
      activity = await prisma.authSessionActivity.create({
        data: { sessionId, authUserId, lastActivityAt: now },
      });
      return true;
    } catch (error) {
      // A parallel first request may have created this same session row.
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      activity = await prisma.authSessionActivity.findUnique({ where: { sessionId } });
      if (!activity) throw error;
    }
  }

  if (activity.authUserId !== authUserId) return false;
  if (isSessionIdleExpired(activity.lastActivityAt, now)) return false;

  if (now.getTime() - activity.lastActivityAt.getTime() >= ACTIVITY_WRITE_INTERVAL_MS) {
    await prisma.authSessionActivity.updateMany({
      where: {
        sessionId,
        authUserId,
        lastActivityAt: activity.lastActivityAt,
      },
      data: { lastActivityAt: now },
    });
  }

  return true;
}
