"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { NOTIFICATION_ICONS } from "@/lib/notification-icons";
import { markNotificationReadAction } from "@/app/(dashboard)/notifications/actions";
import { timeAgo, cn } from "@/utils";
import type { Notification } from "@/types";

export function NotificationCenterList({ notifications }: { notifications: Notification[] }) {
  async function handleClick(notification: Notification) {
    if (!notification.isRead) await markNotificationReadAction(notification.id);
  }

  return (
    <div className="glass flex flex-col divide-y divide-border rounded-2xl">
      {notifications.map((notification) => {
        const Icon = NOTIFICATION_ICONS[notification.type] ?? Info;
        const row = (
          <div
            className={cn(
              "flex gap-4 px-5 py-4 transition-colors hover:bg-muted/40",
              !notification.isRead && "bg-primary/5"
            )}
          >
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="h-4.5 w-4.5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{notification.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{notification.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{timeAgo(notification.createdAt)}</p>
            </div>
            {!notification.isRead && (
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-400" aria-hidden />
            )}
          </div>
        );

        return notification.linkUrl ? (
          <Link key={notification.id} href={notification.linkUrl} onClick={() => handleClick(notification)}>
            {row}
          </Link>
        ) : (
          <button key={notification.id} type="button" onClick={() => handleClick(notification)} className="w-full text-left">
            {row}
          </button>
        );
      })}
    </div>
  );
}
