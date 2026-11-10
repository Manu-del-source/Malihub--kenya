import Link from "next/link";
import type { Metadata } from "next";
import { Bell, MessageCircle, Package } from "lucide-react";

export const metadata: Metadata = { title: "Message Centre" };

export default function MessagesIndexPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary-300">
        <MessageCircle className="h-6 w-6" aria-hidden />
      </div>
      <p className="mt-4 font-display text-xl font-semibold">Message Centre</p>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        Select an existing conversation from your inbox. Order and account notifications are available in their own centre.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/notifications" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:text-primary-300">
          <Bell className="h-4 w-4" aria-hidden />
          Notifications
        </Link>
        <Link href="/buyer/orders" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:text-primary-300">
          <Package className="h-4 w-4" aria-hidden />
          My orders
        </Link>
      </div>
    </div>
  );
}
