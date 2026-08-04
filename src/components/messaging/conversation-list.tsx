"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Avatar from "@radix-ui/react-avatar";
import { Search, MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { timeAgo, cn } from "@/utils";
import type { ChatListItem } from "@/services/chat-service";

function otherParticipant(chat: ChatListItem, currentUserId: string) {
  const isBuyer = chat.buyerId === currentUserId;
  const other = isBuyer ? chat.seller : chat.buyer;
  return {
    id: other.id,
    name: other.profile?.fullName || "MaliHub user",
    avatarUrl: other.profile?.avatarUrl ?? null,
  };
}

export function ConversationList({
  chats,
  currentUserId,
}: {
  chats: ChatListItem[];
  currentUserId: string;
}) {
  const [query, setQuery] = useState("");
  const pathname = usePathname();

  const filtered = useMemo(() => {
    if (!query.trim()) return chats;
    const q = query.trim().toLowerCase();
    return chats.filter((chat) => {
      const other = otherParticipant(chat, currentUserId);
      return (
        other.name.toLowerCase().includes(q) ||
        chat.product?.title.toLowerCase().includes(q) ||
        chat.messages[0]?.content?.toLowerCase().includes(q)
      );
    });
  }, [chats, query, currentUserId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="h-10 w-full rounded-full border border-border bg-background/60 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={MessageCircle}
            title={chats.length === 0 ? "No conversations yet" : "No matches"}
            description={
              chats.length === 0
                ? "Message a seller from any listing to start a conversation."
                : "Try a different search term."
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {filtered.map((chat) => {
            const other = otherParticipant(chat, currentUserId);
            const lastMessage = chat.messages[0];
            const isActive = pathname === `/messages/${chat.id}`;

            return (
              <Link
                key={chat.id}
                href={`/messages/${chat.id}`}
                className={cn(
                  "flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors hover:bg-muted/50",
                  isActive && "bg-muted"
                )}
              >
                <Avatar.Root className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-medium text-primary-foreground">
                  {other.avatarUrl && <Avatar.Image src={other.avatarUrl} alt="" className="h-full w-full object-cover" />}
                  <Avatar.Fallback>{other.name[0]?.toUpperCase()}</Avatar.Fallback>
                </Avatar.Root>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{other.name}</p>
                    {lastMessage && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgo(lastMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">
                      {lastMessage?.deletedAt
                        ? "Message deleted"
                        : lastMessage?.imageUrl && !lastMessage?.content
                          ? "📷 Photo"
                          : lastMessage?.content || chat.product?.title || "Say hello"}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                        {chat.unreadCount > 9 ? "9+" : chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
