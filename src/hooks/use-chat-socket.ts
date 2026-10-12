"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Message } from "@/types";
import { chatSocket, type ChatSocketListener } from "@/lib/chat/ws-client";
import type { ChatMessageRow } from "@/lib/chat/protocol";

const TYPING_TIMEOUT_MS = 3000;

/**
 * Wire rows carry ISO date strings (exactly what the HTTP API delivers too);
 * the thread's `Message`-typed state already contains such strings at runtime
 * (the Supabase realtime hook this replaces cast Postgres payloads the same
 * way, before it was deleted in Phase 4). Centralizing the cast here keeps the
 * `Date`/`string` mismatch in one documented place.
 */
function asMessage(row: ChatMessageRow): Message {
  return row as unknown as Message;
}

/**
 * Realtime state for one chat thread. This replaced the Supabase Realtime hook
 * (`use-chat-realtime.ts`, deleted in Phase 4 — docs/SUPABASE-REMOVAL-PLAN.md
 * §5) and keeps its contract.
 *
 * Same contract, same consumers:
 *   - `typingUserIds` / `onlineUserIds` sets for the badges,
 *   - `sendTyping()` for the composer,
 *   - `onMessageInsert` / `onMessageUpdate` wired to the thread's optimistic
 *     state (which de-duplicates by message id, so a redelivered event is a
 *     no-op — the duplicate-event protection requirement).
 *
 * Delivery comes from the FastAPI WebSocket (one shared per-tab connection,
 * see `ws-client.ts`). The database/HTTP API remains the source of truth;
 * this hook only mirrors live notifications. If the socket is down or
 * realtime is unconfigured, the sets simply stay empty and chat works over
 * HTTP — there is no silent fallback to any other broadcast path.
 */
export function useChatSocket({
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
  const callbacksRef = useRef({ onMessageInsert, onMessageUpdate });
  callbacksRef.current = { onMessageInsert, onMessageUpdate };

  // Rows this hook has seen, so a `messages_read` event (which carries only
  // ids) can be turned into per-message updates for the rows on screen.
  // Rows that were never loaded here will be correct on the next history
  // fetch — the DB is the source of truth either way.
  const knownMessagesRef = useRef<Map<string, ChatMessageRow>>(new Map());
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const typingTimeouts = typingTimeoutsRef.current;
    knownMessagesRef.current = new Map();
    setTypingUserIds(new Set());
    setOnlineUserIds(new Set());

    const rememberRow = (row: ChatMessageRow): ChatMessageRow => {
      knownMessagesRef.current.set(row.id, row);
      return row;
    };

    const listener: ChatSocketListener = {
      onMessageInsert: (row) => {
        callbacksRef.current.onMessageInsert(asMessage(rememberRow(row)));
      },
      onMessageUpdate: (row) => {
        callbacksRef.current.onMessageUpdate(asMessage(rememberRow(row)));
      },
      onMessagesRead: (_readBy, readAt, messageIds) => {
        for (const id of messageIds) {
          const row = knownMessagesRef.current.get(id);
          if (!row) continue;
          callbacksRef.current.onMessageUpdate(
            asMessage(rememberRow({ ...row, readAt: row.readAt ?? readAt }))
          );
        }
      },
      onJoined: (onlineUserIdsSnapshot) => {
        setOnlineUserIds(new Set(onlineUserIdsSnapshot));
      },
      onTyping: (typingUser) => {
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
      },
      onPresence: (presenceUser, online) => {
        if (presenceUser === userId) return;
        setOnlineUserIds((prev) => {
          const next = new Set(prev);
          if (online) next.add(presenceUser);
          else next.delete(presenceUser);
          return next;
        });
      },
    };

    return chatSocket.subscribe(chatId, userId, listener);
  }, [chatId, userId]);

  const sendTyping = useCallback(() => {
    chatSocket.sendTyping(chatId);
  }, [chatId]);

  return { typingUserIds, onlineUserIds, sendTyping };
}
