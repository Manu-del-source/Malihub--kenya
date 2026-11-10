"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Send } from "lucide-react";
import { supportWhatsAppUrl, SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

type Link_ = { label: string; href: string; external?: boolean };
type Topic = { id: string; chip: string; keywords: string[]; answer: string; links?: Link_[] };
type Msg = { id: number; from: "bot" | "user"; text: string; links?: Link_[] };

const WHATSAPP: Link_ = { label: `Chat on WhatsApp (${SUPPORT_WHATSAPP_DISPLAY})`, href: supportWhatsAppUrl(), external: true };

const TOPICS: Topic[] = [
  { id: "track", chip: "Track my order", keywords: ["track", "order", "where", "delivery", "shipping", "status"],
    answer: "You can see the status of every order under My orders. Order updates also appear in your Message Centre under Order Updates.",
    links: [{ label: "My orders", href: "/buyer/orders" }, { label: "Order Updates", href: "/notifications?group=orders" }] },
  { id: "payment", chip: "Payment problem", keywords: ["pay", "payment", "mpesa", "m-pesa", "charged", "refund", "money"],
    answer: "If a payment didn't go through, or you were charged but your order didn't update, please send us your order number and the payment confirmation message on WhatsApp so we can check it quickly.",
    links: [WHATSAPP] },
  { id: "sell", chip: "Selling on MaliHub", keywords: ["sell", "seller", "listing", "shop", "verify", "verified", "product"],
    answer: "Open your Seller Centre to add products and manage listings. Products appear in the marketplace once they're active and your seller account is verified.",
    links: [{ label: "Seller Centre", href: "/seller-center" }] },
  { id: "seller-chat", chip: "Contact a seller", keywords: ["seller chat", "message seller", "contact seller", "chat"],
    answer: "Open any product and tap the message button to chat with the seller. Your conversations are listed under Chats with Sellers in the Message Centre.",
    links: [{ label: "Browse products", href: "/marketplace" }] },
  { id: "account", chip: "My account", keywords: ["account", "password", "login", "log in", "sign", "profile", "email"],
    answer: "You can update your profile and account details from your Account page.",
    links: [{ label: "Account", href: "/account" }] },
];

const GREETING: Msg = {
  id: 0, from: "bot",
  text: "Hi, I'm MaliBot. What do you need help with? Pick a topic or type your question.",
};

function match(input: string): Topic | null {
  const q = input.toLowerCase();
  let best: { t: Topic; score: number } | null = null;
  for (const t of TOPICS) {
    const score = t.keywords.filter((k) => q.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t ?? null;
}

export function MaliBot() {
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function push(user: string, reply: { text: string; links?: Link_[] }) {
    setMessages((m) => [
      ...m,
      { id: nextId.current++, from: "user", text: user },
      { id: nextId.current++, from: "bot", ...reply },
    ]);
  }

  function pickTopic(t: Topic) { push(t.chip, { text: t.answer, links: t.links }); }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    const t = match(text);
    if (t) push(text, { text: t.answer, links: t.links });
    else
      push(text, {
        text: "I'm not sure about that one. A support agent can help you directly on WhatsApp.",
        links: [{ ...WHATSAPP, href: supportWhatsAppUrl(`Hello MaliHub support. ${text}`) }],
      });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3">
        <Link href="/messages" aria-label="Back" className="rounded-full p-1.5 hover:bg-muted lg:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-white"><Bot className="h-5 w-5" /></span>
        <div>
          <p className="text-sm font-semibold">MaliBot</p>
          <p className="text-xs text-muted-foreground">Order &amp; account help</p>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div key={m.id} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${m.from === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              <p>{m.text}</p>
              {m.links && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.links.map((l) =>
                    l.external ? (
                      <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="rounded-full border border-primary/40 px-3 py-1 text-xs font-medium text-primary-300">{l.label}</a>
                    ) : (
                      <Link key={l.label} href={l.href} className="rounded-full border border-primary/40 px-3 py-1 text-xs font-medium text-primary-300">{l.label}</Link>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border px-3 pt-2">
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
          {TOPICS.map((t) => (
            <button key={t.id} type="button" onClick={() => pickTopic(t)} className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:border-primary/50">
              {t.chip}
            </button>
          ))}
        </div>
        <form onSubmit={send} className="flex items-center gap-2 pb-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your question…"
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background/60 px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button type="submit" aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
