"use client";

import Link from "next/link";
import { Bot, ChevronRight, ClipboardList, Headset, Megaphone, MessageSquareText, Tag, type LucideIcon } from "lucide-react";
import { NotificationPrompt } from "@/components/messaging/notification-prompt";
import { supportWhatsAppUrl } from "@/lib/support";

export type HubUnread = { system: number; orders: number; promotions: number; comments: number };

type Row = {
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
  tile: string;
  external?: boolean;
  badge?: number;
};

export function MessageCenterHub({ unread }: { unread: HubUnread }) {
  const rows: Row[] = [
    { label: "Contact Us With Chat", hint: "WhatsApp support", href: supportWhatsAppUrl(), icon: Headset, tile: "from-emerald-400 to-emerald-600", external: true },
    { label: "Order Query", hint: "Ask MaliBot", href: "/messages/assistant", icon: Bot, tile: "from-pink-400 to-rose-500" },
    { label: "System Message", href: "/notifications?group=system", icon: Megaphone, tile: "from-yellow-300 to-amber-500", badge: unread.system },
    { label: "Order Updates", href: "/notifications?group=orders", icon: ClipboardList, tile: "from-lime-400 to-green-500", badge: unread.orders },
    { label: "Promotions", href: "/notifications?group=promotions", icon: Tag, tile: "from-orange-400 to-orange-600", badge: unread.promotions },
    { label: "Comments", href: "/notifications?group=comments", icon: MessageSquareText, tile: "from-red-400 to-rose-600", badge: unread.comments },
  ];

  return (
    <div className="shrink-0">
      <NotificationPrompt />
      <ul className="divide-y divide-border/60">
        {rows.map((row) => {
          const Icon = row.icon;
          const content = (
            <>
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${row.tile} text-white`}>
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-foreground">{row.label}</span>
                {row.hint && <span className="block truncate text-xs text-muted-foreground">{row.hint}</span>}
              </span>
              {!!row.badge && row.badge > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {row.badge > 99 ? "99+" : row.badge}
                </span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </>
          );
          const cls = "flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50";
          return (
            <li key={row.label}>
              {row.external ? (
                <a href={row.href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>
              ) : (
                <Link href={row.href} className={cls}>{content}</Link>
              )}
            </li>
          );
        })}
      </ul>
      <h2 className="border-y border-border bg-muted/30 px-4 py-3 font-display text-base font-semibold">Chats with Sellers</h2>
    </div>
  );
}
