import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/safe-log";
import { NOTIFICATION_VIEW_SELECT, toNotificationView } from "@/lib/notifications/notification-view";

export async function GET() {
  const user = (await getCurrentUser())?.user;

  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: NOTIFICATION_VIEW_SELECT,
      }),
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
    ]);

    return NextResponse.json({ success: true, data: { notifications: notifications.map(toNotificationView), unreadCount } });
  } catch (error) {
    logServerError("GET /api/notifications failed", error);
    return NextResponse.json({ success: false, error: "Couldn't load notifications." }, { status: 500 });
  }
}
