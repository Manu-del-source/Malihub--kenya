"use client";

import { usePathname } from "next/navigation";
import { ConversationList } from "@/components/messaging/conversation-list";
import { MessageCenterHub, type HubUnread } from "@/components/messaging/message-center-hub";
import { cn } from "@/utils";
import type { ChatListItem } from "@/services/chat-service";

export function MessagesShell({
  chats,
  currentUserId,
  unread,
  children,
}: {
  chats: ChatListItem[];
  currentUserId: string;
  unread: HubUnread;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isThreadOpen = pathname !== "/messages";

  return (
    <div className="flex h-[calc(100svh-129px)] lg:h-[calc(100svh-65px)] overflow-hidden">
      <div
        className={cn(
          "w-full shrink-0 overflow-y-auto border-r border-border lg:block lg:w-80",
          isThreadOpen ? "hidden" : "block"
        )}
      >
        <MessageCenterHub unread={unread} />
        <div className="lg:min-h-0">
          <ConversationList chats={chats} currentUserId={currentUserId} />
        </div>
      </div>
      <div className={cn("flex-1", !isThreadOpen && "hidden lg:block")}>{children}</div>
    </div>
  );
}
