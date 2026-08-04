"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Message } from "@/types";

const TYPING_TIMEOUT_MS = 3000;

export function useChatRealtime({
  chatId,
  userId,
  onMessageInsert,
  onMessageUpdate,
}: {
  chatId: string;
  userId: string;
  onMessageInsert: (message: Message) => void;
  onMessageUpdate: (message: Message) => void;
}) {
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`chat:${chatId}`, {
      config: { presence: { key: userId } },
    });
    const typingTimeouts = typingTimeoutsRef.current;

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => onMessageInsert(payload.new as Message)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => onMessageUpdate(payload.new as Message)
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const typingUser = payload?.userId as string | undefined;
        if (!typingUser || typingUser === userId) return;

        setTypingUserIds((prev) => new Set(prev).add(typingUser));

        const existingTimeout = typingTimeouts.get(typingUser);
        if (existingTimeout) clearTimeout(existingTimeout);
        typingTimeouts.set(
          typingUser,
          setTimeout(() => {
            setTypingUserIds((prev) => {
              const next = new Set(prev);
              next.delete(typingUser);
              return next;
            });
          }, TYPING_TIMEOUT_MS)
        );
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUserIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId, onlineAt: new Date().toISOString() });
        }
      });

    channelRef.current = channel;

    return () => {
      typingTimeouts.forEach((t) => clearTimeout(t));
      typingTimeouts.clear();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are expected to be stable per mount; re-subscribing on every render would thrash the websocket
  }, [chatId, userId]);

  const sendTyping = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId },
    });
  }, [userId]);

  return { typingUserIds, onlineUserIds, sendTyping };
}
