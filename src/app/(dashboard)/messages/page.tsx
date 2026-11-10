import Link from "next/link";
import type { Metadata } from "next";
import { Bell, Bot, Headset, Package } from "lucide-react";
import { supportWhatsAppUrl } from "@/lib/support";

export const metadata: Metadata = { title: "Message Centre" };

export default function MessagesIndexPage() {
  const actions = [
    { title: "Chat with MaliBot", description: "Get instant help with orders, payments, delivery and your account.", href: "/messages/assistant", icon: Bot },
    { title: "My orders", description: "Review your orders and check the latest available status.", href: "/buyer/orders", icon: Package },
    { title: "Notifications", description: "View order updates and important account messages.", href: "/notifications", icon: Bell },
  ];

  return (
    <div className="flex h-full flex-col justify-center px-5 py-8">
      <div className="mx-auto w-full max-w-lg">
        <p className="font-display text-2xl font-semibold">Message Centre</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Get help from MaliBot, review order updates or contact the MaliHub support team.
        </p>
        <div className="mt-6 space-y-3">
          {actions.map(({ title, description, href, icon: Icon }) => (
            <Link key={title} href={href} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-300">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
              </span>
            </Link>
          ))}
          <a href={supportWhatsAppUrl()} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-300">
              <Headset className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Contact MaliHub Support</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">Speak to a person on WhatsApp if you need further help.</span>
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
