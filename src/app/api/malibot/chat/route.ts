import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { verifySameOrigin } from "@/lib/csrf";
import { formatRetryAfter, rateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/safe-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2000),
  })).min(1).max(12),
});

const SYSTEM_PROMPT = `You are MaliBot, the official customer-support assistant for MaliHub Kenya, a Kenyan online marketplace.
Your job is to help buyers and sellers with marketplace navigation, accounts, listings, orders, delivery, payments, returns, and general platform questions.
Be warm, concise, practical, and use Kenyan context (KES, M-Pesa, counties) where relevant.
Never claim you have accessed a customer's account, order, payment, seller status, or delivery tracking. You do not have live database access. Direct customers to My Orders or Order Updates for their actual status.
Never say a payment succeeded, a refund was issued, or an order was dispatched unless the customer provides verified evidence; explain how to contact support for an account-specific investigation.
Do not invent policies, delivery times, fees, seller details, stock, or guarantees. If unsure, say so clearly and offer the official support channel.
MaliHub does not promise escrow. Do not tell buyers to contact sellers through direct chat; route support issues through MaliHub support.
For payment problems, ask the customer to provide their order number and payment confirmation to official support. Do not request passwords, PINs, OTPs, full card details, or secret credentials.
For account access, point to the Account page or password reset flow. For selling, point to Seller Centre. For order history, point to My Orders.
Do not output markdown links or fabricate URLs. Keep answers readable and focused.`;

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const user = (await getCurrentUser())?.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Sign in to use MaliBot." }, { status: 401 });
  }

  const limit = await rateLimit.api(`malibot:${user.id}`);
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: `Too many messages. Please try again in ${formatRetryAfter(limit.reset)}.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) } },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Please send a shorter message and try again." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "MaliBot AI is not configured yet. Please contact MaliHub support." },
      { status: 503 },
    );
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: parsed.data.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 450,
          },
        }),
        signal: AbortSignal.timeout(25000),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      logServerError("MaliBot Gemini request failed", new Error(`gemini_status_${response.status}`));
      const status = response.status === 429 ? 503 : 502;
      return NextResponse.json(
        { success: false, error: status === 503
          ? "MaliBot has reached its current usage limit. Please try again later."
          : "MaliBot could not respond just now. Please try again." },
        { status },
      );
    }

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const reply = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return NextResponse.json({ success: false, error: "MaliBot returned an empty response. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ success: true, reply });
  } catch (error) {
    logServerError("POST /api/malibot/chat failed", error);
    return NextResponse.json(
      { success: false, error: "MaliBot is temporarily unavailable. Please try again." },
      { status: 502 },
    );
  }
}
