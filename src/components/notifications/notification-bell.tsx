"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Info } from "lucide-react";
import { NOTIFICATION_ICONS } from "@/lib/notification-icons";
import { useNotifications } from "@/hooks/use-notifications";
import { markNotificationReadAction } from "@/app/(dashboard)/notifications/actions";
import { timeAgo, cn } from "@/utils";
import type { Notification } from "@/types";

function NotificationRow({ notification }: { notification: Notification }) {
  const Icon = NOTIFICATION_ICONS[notification.type] ?? Info;

  async function handleClick() {
    if (!notification.isRead) await markNotificationReadAction(notification.id);
  }

  const content = (
    <div
      className={cn(
        "flex gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted",
        !notification.isRead && "bg-primary/5"
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium text-foreground">{notification.title}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(notification.createdAt)}</p>
      </div>
      {!notification.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-400" aria-hidden />}
    </div>
  );

  return notification.linkUrl ? (
    <Link href={notification.linkUrl} onClick={handleClick}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={handleClick} className="w-full">
      {content}
    </button>
  );
}

export function NotificationBell({ isSignedIn }: { isSignedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useNotifications(isSignedIn);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!isSignedIn) return null;

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass absolute right-0 top-full z-30 mt-2 w-80 rounded-xl p-2"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <p className="text-sm font-medium text-foreground">Notifications</p>
              <Link
                href="/dashboard/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-primary-400 hover:underline"
              >
                View all
              </Link>
            </div>
            {!data || data.notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&rsquo;re all caught up.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
                {data.notifications.map((n) => (
                  <NotificationRow key={n.id} notification={n} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
