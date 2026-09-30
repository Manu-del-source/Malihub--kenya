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
  | "moderation.listing_restored"
  | "moderation.seller_verified"
  | "moderation.seller_rejected"
  | "moderation.user_suspended"
  | "moderation.user_banned"
  | "moderation.report_resolved"
  | "user.blocked_another_user"
  | "user.role_changed"
  | "admin.category_created"
  | "admin.category_updated"
  | "admin.category_deleted"
  // ─── Order lifecycle (Phase 9.1) ───────────────────────────────────────────
  // Every `Order.status` change goes through `order-transition-service.ts`, and
  // each of these records one. They were added because the transition service
  // was: without them, "who moved this order, and from what state?" has no
  // answer for any order that has ever been cancelled, paid, or fulfilled.
  | "order.paid"
  | "order.cancelled"
  | "order.shipped"
  | "order.delivered"
  | "order.completed"
  // ─── Payment collection (Phase 9.2-A) ──────────────────────────────────────
  // Payment-level facts the `order.*` actions can't express. `order.paid`
  // already covers the successful order transition (written by markOrderPaid);
  // these cover the Payment side: a collection started by a buyer, a
  // provider-reported failure (buyer can retry), and the two anomaly classes
  // that must be findable without digging through payment_events — a callback
  // whose amount disagrees with the authoritative row, and a settled payment
  // whose order cannot be marked paid (e.g. cancellation won the race, which
  // a later refund/reconciliation phase acts on). Metadata rules are the same
  // as everywhere else here: amounts and references, never payer PII or
  // credentials.
  | "payment.initiated"
  // `payment.success`: this attempt transitioned to SUCCESS (the order's own
  // transition is `order.paid` via markOrderPaid). Fired once per payment —
  // replays and recovery never re-emit it.
  | "payment.success"
  | "payment.failed"
  // Distinct from `payment.failed`: the buyer cancelled the STK prompt, which
  // never cancels the ORDER — the order stays PENDING and payable, and a
  // retry is a legitimate new attempt.
  | "payment.cancelled"
  | "payment.amount_mismatch"
  | "payment.anomaly";

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
