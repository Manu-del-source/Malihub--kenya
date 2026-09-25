import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotificationCenterList } from "@/components/notifications/notification-center-list";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";

/**
 * Rendered per request — never prerendered: this route reads the session.
 *
 * Required because reading a Neon Auth session does not necessarily touch a
 * cookie (an unconfigured environment short-circuits first), so Next.js would
 * otherwise prerender this page as a static redirect to /login. The full
 * reasoning is in the layout banners and docs/auth/ARCHITECTURE.md §6.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { user } = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const hasUnread = notifications.some((n: (typeof notifications)[number]) => !n.isRead);

  return (
    <Container className="max-w-2xl py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-display text-3xl font-medium">Notifications</h1>
        {hasUnread && <MarkAllReadButton />}
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Messages, favorites, orders, and reviews will show up here."
        />
      ) : (
        <NotificationCenterList notifications={notifications} />
      )}
    </Container>
  );
}
