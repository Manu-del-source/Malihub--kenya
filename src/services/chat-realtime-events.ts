import "server-only";
import { logServerError } from "@/lib/safe-log";

import type { Message } from "@prisma/client";
import { getRedis } from "@/lib/redis";
import { CHAT_EVENTS_CHANNEL, type ChatMessageRow, type ChatRealtimeOutgoingEvent } from "@/lib/chat/protocol";

/**
 * Normalize a Prisma `Message` row into the wire shape. Dates become ISO
 * strings (the thread already treats them as the HTTP API delivers them);
 * a deleted message keeps its row with `content: null`.
 */
export function toMessageRow(message: Message): ChatMessageRow {
  return {
    id: message.id,
    chatId: message.chatId,
    senderId: message.senderId,
    content: message.content,
    imageUrl: message.imageUrl,
    readAt: message.readAt ? message.readAt.toISOString() : null,
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Publish a chat event to the realtime notification channel, AFTER the
 * authorized database write has already succeeded.
 *
 * Deliberately fire-and-forget and total (never throws, never rejects):
 * Redis is a notification channel, not a store — the database write is the
 * source of truth and has already committed. A Redis outage or a slow
 * publish must never fail the HTTP response or block the write path.
 *
 * Degradation contract: if `getRedis()` is null or the publish fails, the
 * event is dropped (logged) and the other participant simply does not see
 * it live — they pick it up on the next history load (HTTP). No fallback
 * ever broadcasts over an unauthenticated path.
 */
export function publishChatEvent(event: ChatRealtimeOutgoingEvent): void {
  let redis;
  try {
    redis = getRedis();
  } catch (error) {
    logServerError("[chat-events] redis unavailable; realtime event dropped", error);
    return;
  }
  if (!redis) return;

  void redis
    .publish(CHAT_EVENTS_CHANNEL, JSON.stringify(event))
    .catch((error) => {
      logServerError("[chat-events] publish failed; realtime event dropped", error);
    });
}
