import "server-only";

import type { PrismaClient, NotificationType } from "@prisma/client";
import { notifyUser } from "@/modules/notifications/service";

type NotificationStore = Pick<PrismaClient, "user">;

/** Best-effort alert to every active administrator. Never blocks a workflow. */
export async function notifyAdministrators(
  db: NotificationStore,
  params: { title: string; body: string; linkUrl?: string; type?: NotificationType },
): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, isActive: true, isBanned: false },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: params.type ?? "SYSTEM",
          title: params.title,
          body: params.body,
          linkUrl: params.linkUrl,
          sendEmailToo: false,
        }).catch(() => undefined),
      ),
    );
  } catch {
    // An alert outage must never roll back a payment, fulfilment or dispute
    // state change. The audit trail and admin exception queue remain.
  }
}

export async function safeNotifyUser(params: Parameters<typeof notifyUser>[0]): Promise<void> {
  await notifyUser(params).catch(() => undefined);
}
