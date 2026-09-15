import "server-only";
import { prisma } from "@/lib/prisma";

/** The fixed vocabulary of things worth an audit trail. Keeping this as a
 * union (not a free-form string) means every call site is self-documenting
 * and a typo can't silently create an untracked action name. */
export type AuditAction =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.signup"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.rate_limited"
  | "listing.created"
  | "listing.updated"
  | "listing.deleted"
  | "listing.archived"
  | "listing.marked_sold"
  | "moderation.listing_suspended"
  | "moderation.listing_approved"
  | "moderation.listing_rejected"
  | "moderation.user_suspended"
  | "moderation.user_banned"
  | "moderation.report_resolved"
  | "user.blocked_another_user"
  | "user.role_changed";

export async function logAuditEvent(params: {
  action: AuditAction;
  actorId?: string | null;
  actorEmail?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        actorId: params.actorId ?? null,
        actorEmail: params.actorEmail ?? null,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: params.metadata as never,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] Failed to write audit log entry", params.action, error);
  }
}

/**
 * Lightweight suspicious-activity heuristic: N+ failed logins for the same
 * email within a short window. Cheap to query (indexed on action+createdAt)
 * and good enough to flag genuine credential-stuffing patterns without
 * standing up a separate detection pipeline.
 */
export async function countRecentFailedLogins(email: string, windowMinutes = 15): Promise<number> {
  return prisma.auditLog.count({
    where: {
      action: "auth.login.failure",
      actorEmail: email.toLowerCase(),
      createdAt: { gte: new Date(Date.now() - windowMinutes * 60_000) },
    },
  });
}
