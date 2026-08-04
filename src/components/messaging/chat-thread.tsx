"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Avatar from "@radix-ui/react-avatar";
import { ArrowLeft, Loader2, MoreVertical, ShieldOff, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MessageBubble } from "@/components/messaging/message-bubble";
import { MessageInput } from "@/components/messaging/message-input";
import { TypingIndicator } from "@/components/messaging/typing-indicator";
import { ImageViewer } from "@/components/messaging/image-viewer";
import { useChatRealtime } from "@/hooks/use-chat-realtime";
import {
  sendMessageAction,
  markChatReadAction,
  loadOlderMessagesAction,
  blockUserAction,
  archiveChatAction,
  deleteChatAction,
} from "@/app/(dashboard)/messages/actions";
import type { Message } from "@/types";

export function ChatThread({
  chatId,
  currentUserId,
  otherUser,
  productTitle,
  initialMessages,
  initialNextCursor,
  isBlocked,
}: {
  chatId: string;
  currentUserId: string;
  otherUser: { id: string; name: string; avatarUrl: string | null };
  productTitle?: string;
  initialMessages: Message[];
  initialNextCursor: string | null;
  isBlocked: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitially = useRef(false);

  const handleMessageInsert = useCallback((message: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
  }, []);

  const handleMessageUpdate = useCallback((message: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
  }, []);

  const { typingUserIds, onlineUserIds, sendTyping } = useChatRealtime({
    chatId,
    userId: currentUserId,
    onMessageInsert: handleMessageInsert,
    onMessageUpdate: handleMessageUpdate,
  });

  const isOtherTyping = typingUserIds.has(otherUser.id);
  const isOtherOnline = onlineUserIds.has(otherUser.id);

  useEffect(() => {
    if (!hasScrolledInitially.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      hasScrolledInitially.current = true;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    markChatReadAction(chatId);
  }, [chatId, messages.length]);

  async function handleLoadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);

    const container = scrollRef.current;
    const previousHeight = container?.scrollHeight ?? 0;

    const result = await loadOlderMessagesAction(chatId, nextCursor);
    setLoadingOlder(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setMessages((prev) => [...result.data.items, ...prev]);
    setNextCursor(result.data.nextCursor);

    requestAnimationFrame(() => {
      if (container) container.scrollTop = container.scrollHeight - previousHeight;
    });
  }

  function handleScroll() {
    if (scrollRef.current && scrollRef.current.scrollTop < 100) {
      handleLoadOlder();
    }
  }

  async function handleSend(input: { content?: string; imageUrl?: string }) {
    const result = await sendMessageAction({ chatId, ...input });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleBlock() {
    setMenuOpen(false);
    const result = await blockUserAction(otherUser.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`${otherUser.name} has been blocked.`);
    router.refresh();
  }

  async function handleArchive() {
    setMenuOpen(false);
    const result = await archiveChatAction(chatId, true);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Conversation archived.");
    router.push("/messages");
  }

  async function handleDelete() {
    setMenuOpen(false);
    const result = await deleteChatAction(chatId);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Conversation deleted.");
    router.push("/messages");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border p-3">
        <Link href="/messages" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="relative h-9 w-9 shrink-0">
          <Avatar.Root className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-secondary text-xs font-medium text-primary-foreground">
            {otherUser.avatarUrl && <Avatar.Image src={otherUser.avatarUrl} alt="" className="h-full w-full object-cover" />}
            <Avatar.Fallback>{otherUser.name[0]?.toUpperCase()}</Avatar.Fallback>
          </Avatar.Root>
          {isOtherOnline && (
            <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{otherUser.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {isOtherTyping ? "typing…" : isOtherOnline ? "Online" : productTitle ? `Re: ${productTitle}` : ""}
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Conversation options"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="glass absolute right-0 top-full z-20 mt-1 w-44 rounded-xl p-1.5">
                <button
                  type="button"
                  onClick={handleArchive}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" /> Archive
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" /> Delete
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  onClick={handleBlock}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                >
                  <ShieldOff className="h-3.5 w-3.5" /> Block {otherUser.name}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.senderId === currentUserId}
            onImageClick={setViewerSrc}
          />
        ))}
        {isOtherTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        onSend={handleSend}
        onTyping={sendTyping}
        disabled={isBlocked}
        disabledReason="You can't message this user."
      />

      <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />
    </div>
  );
}
