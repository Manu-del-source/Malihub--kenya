"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Send } from "lucide-react";
import { supportWhatsAppUrl, SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

type Message = { id: string; role: "user" | "assistant"; content: string };

const STORAGE_KEY = "malihub:malibot:conversation:v1";
const SUGGESTIONS = [
  "How do I track my order?",
  "I have a payment problem",
  "How do I sell on MaliHub?",
  "How do I reset my password?",
];

const GREETING: Message = {
  id: "greeting",
  role: "assistant",
  content: "Hello! I'm MaliBot, MaliHub's support assistant. Ask me about orders, payments, delivery, selling, listings or your account. I’ll guide you to the right place.",
};

export function MaliBot() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Message[];
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 25) {
        const safe = parsed.filter((m) =>
          m && typeof m.id === "string" &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
        );
        if (safe.length) setMessages(safe);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-25)));
    } catch {
      // Conversation still works when browser storage is unavailable.
    }
  }, [messages]);

  async function sendMessage(value: string) {
    const content = value.trim();
    if (!content || busy) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/malibot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          messages: next
            .filter((message) => message.id !== "greeting")
            .slice(-12)
            .map(({ role, content: text }) => ({ role, content: text })),
        }),
      });
      const payload = await response.json() as { success?: boolean; reply?: string; error?: string };
      if (!response.ok || !payload.success || !payload.reply) {
        throw new Error(payload.error || "MaliBot could not respond. Please try again.");
      }
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: payload.reply! },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3">
        <Link href="/messages" aria-label="Back" className="rounded-full p-1.5 hover:bg-muted lg:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-white">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">MaliBot AI Support</p>
          <p className="text-xs text-muted-foreground">MaliHub Kenya · {busy ? "Replying…" : "Ask us anything"}</p>
        </div>
        <a
          href={supportWhatsAppUrl("Hello MaliHub support, I need help.")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary-300 hover:underline"
        >
          Human support
        </a>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${
              message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
            }`}>
              {message.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">MaliBot is thinking…</div>
          </div>
        )}
        {error && (
          <div className="mx-auto max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-center text-xs text-destructive">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border px-3 pt-2">
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={busy}
              onClick={() => void sendMessage(suggestion)}
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:border-primary/50 disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 pb-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={2000}
            disabled={busy}
            placeholder="Ask MaliBot a question…"
            aria-label="Message MaliBot"
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background/60 px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={busy || !input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
        <p className="pb-2 text-center text-[10px] text-muted-foreground">
          Don’t share passwords, M-Pesa PINs, OTPs or card details. MaliBot cannot view live order or payment records.
        </p>
      </div>
    </div>
  );
}
