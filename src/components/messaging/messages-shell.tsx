"use client";

import { usePathname } from "next/navigation";
import { ConversationList } from "@/components/messaging/conversation-list";
import { cn } from "@/utils";
import type { ChatListItem } from "@/services/chat-service";

export function MessagesShell({
  chats,
  currentUserId,
  children,
}: {
  chats: ChatListItem[];
  currentUserId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isThreadOpen = pathname !== "/messages";

  return (
    <div className="flex h-[calc(100svh-65px)] overflow-hidden">
      <div
        className={cn(
          "w-full shrink-0 border-r border-border lg:block lg:w-80",
          isThreadOpen ? "hidden" : "block"
        )}
      >
        <ConversationList chats={chats} currentUserId={currentUserId} />
      </div>
      <div className={cn("flex-1", !isThreadOpen && "hidden lg:block")}>{children}</div>
    </div>
  );
}
