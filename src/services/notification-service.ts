import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/services/email-service";
import { NotificationEmail } from "@/emails/notification-email";
import type { NotificationType } from "@prisma/client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://malihub.co.ke";

const DEFAULT_EMAIL_TYPES = new Set<NotificationType>([
  "PAYMENT_UPDATE",
  "ORDER_UPDATE",
  "LISTING_APPROVED",
  "LISTING_REJECTED",
]);

export async function notifyUser(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkUrl?: string;
  sendEmailToo?: boolean;
}) {
  const shouldEmail = params.sendEmailToo ?? DEFAULT_EMAIL_TYPES.has(params.type);

  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      channel: shouldEmail ? "BOTH" : "IN_APP",
      title: params.title,
      body: params.body,
      linkUrl: params.linkUrl,
    },
  });

  if (shouldEmail) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true },
    });
    if (user?.email) {
      await sendEmail({
        to: user.email,
        subject: params.title,
        react: NotificationEmail({
          heading: params.title,
          body: params.body,
          ctaLabel: params.linkUrl ? "View on MaliHub" : undefined,
          ctaUrl: params.linkUrl ? `${APP_URL}${params.linkUrl}` : undefined,
        }),
      });
    }
  }

  return notification;
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}
