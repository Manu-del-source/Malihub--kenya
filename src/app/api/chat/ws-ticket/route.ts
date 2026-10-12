import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { WS_TICKET_KEY_PREFIX } from "@/lib/chat/protocol";

/**
 * One-shot WebSocket tickets for the FastAPI chat realtime surface.
 *
 * Why a ticket at all: the session cookie is not readable from the browser
 * JS (httpOnly), so the browser cannot attach its identity to a raw
 * WebSocket upgrade on another origin (the FastAPI host). Instead:
 *
 *   1. The browser POSTs here (same-origin, session-authenticated).
 *   2. We store `malihub:api:chat:ws-ticket:<ticket> = <userId>` in Upstash
 *      Redis with a 60-second TTL. The ticket is 256 random bits, so it is
 *      unguessable AND short-lived.
 *   3. The browser opens `wss://…/api/v1/chat/ws?ticket=<t>` against
 *      FastAPI, which GETDELs the key — one use, then gone.
 *
 * The user id is therefore resolved server-side at both ends; a client never
 * tells us who it is over the wire.
 *
 * NOTE: this endpoint issues tickets for the connection, not for a specific
 * chat — chat membership is re-checked by FastAPI on every `join` against
 * the database.
 */

export const dynamic = "force-dynamic";

const TICKET_TTL_SECONDS = 60;
const CHAT_ID_SCHEMA = z.string().uuid();

export async function POST(request: NextRequest) {
  const originCheck = verifySameOrigin(request);
  if (originCheck) return originCheck;

  const current = await getCurrentUser();
  const user = current?.user;
  // A chat participant is a MaliHub row (public.users). A valid session with
  // no MaliHub row yet cannot join any chat, so it cannot get a useful ticket.
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  }
  const userId = user.id;

  const limit = await rateLimit.chatWsTicket(userId);
  if (!limit.success) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many realtime connections. Try again ${formatRetryAfter(limit.reset)}.`,
        code: "rate_limited",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) },
      }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_CHAT_WS_BASE_URL;
  if (!baseUrl) {
    // Realtime is not configured on this deployment. Chat keeps working over
    // HTTP — the client treats this as "realtime unavailable" and stops
    // retrying until the next page interaction.
    return NextResponse.json(
      { success: false, error: "Realtime is not configured on this deployment." },
      { status: 503 }
    );
  }

  const redis = getRedis();
  if (!redis) {
    // Same degradation rule as the avatar route: without Redis we cannot
    // issue a one-shot ticket, so realtime is off for this connection. HTTP
    // chat is unaffected.
    return NextResponse.json(
      { success: false, error: "Realtime is temporarily unavailable." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = z
    .object({
      chatId: CHAT_ID_SCHEMA.optional(),
    })
    .safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  // Accept an optional chatId so callers can pre-check participation before
  // paying for a ticket (mirrors the HTTP chat API's 404-for-non-participants
  // rule). The ticket itself is still connection-scoped: FastAPI re-checks
  // membership on every join, so a ticket cannot be "spent" into a chat the
  // user does not belong to.
  if (parsed.data.chatId) {
    let chat: { buyerId: string; sellerId: string } | null;
    try {
      chat = await prisma.chat.findUnique({
        where: { id: parsed.data.chatId },
        select: { buyerId: true, sellerId: true },
      });
    } catch {
      // The DB is the authorization source for this check — if it is down,
      // fail closed with the same degradation the client already understands.
      return NextResponse.json(
        { success: false, error: "Realtime is temporarily unavailable." },
        { status: 503 }
      );
    }
    if (!chat || (chat.buyerId !== userId && chat.sellerId !== userId)) {
      // Same 404 the HTTP chat routes use — do not confirm the chat exists.
      return NextResponse.json({ success: false, error: "Chat not found." }, { status: 404 });
    }
  }

  const ticket = randomBytes(32).toString("hex");
  try {
    // The ticket must exist in Redis before it is handed out — a failed
    // write would 4401 at the socket, so surface it here instead. A resolved
    // promise is success (the client throws on transport/REST errors).
    await redis.set(`${WS_TICKET_KEY_PREFIX}:${ticket}`, userId, { ex: TICKET_TTL_SECONDS });
  } catch {
    return NextResponse.json(
      { success: false, error: "Realtime is temporarily unavailable." },
      { status: 503 }
    );
  }

  const wsBase = baseUrl.replace(/\/+$/, "");
  return NextResponse.json({
    success: true,
    data: {
      url: `${wsBase}/api/v1/chat/ws?ticket=${ticket}`,
    },
  });
}
