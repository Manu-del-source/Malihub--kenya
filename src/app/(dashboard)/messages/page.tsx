import Link from "next/link";
import type { Metadata } from "next";
import { Bell, Bot, Package } from "lucide-react";
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
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true"><path d="M20.52 3.48A11.8 11.8 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.37-1.67a11.86 11.86 0 0 0 5.67 1.44h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.24-6.15-3.39-8.43zM12.05 21.75h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.78.99 1.01-3.69-.23-.38a9.84 9.84 0 0 1-1.51-5.22c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.89-9.89 9.89zm5.43-7.4c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01s-.52.07-.79.37c-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.17.2 2.1 3.2 5.09 4.49.71.31 1.26.5 1.69.64.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z"/></svg>
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
