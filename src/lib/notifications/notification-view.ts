import "server-only";
import type { Prisma } from "@prisma/client";

/** The notification UI needs neither the owner id nor delivery channel. */
export const NOTIFICATION_VIEW_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  linkUrl: true,
  isRead: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_VIEW_SELECT }>;
export function toNotificationView(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    isRead: row.isRead,
    createdAt: row.createdAt,
  };
}
