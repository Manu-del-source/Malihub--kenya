"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const DISMISS_KEY = "malihub:notif-prompt-dismissed";

/** Asks the browser for notification permission; hidden once granted, denied or dismissed. */
export function NotificationPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "default") return;
      if (localStorage.getItem(DISMISS_KEY)) return;
      setVisible(true);
    } catch {
      /* storage or Notification unavailable */
    }
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
  }

  async function enable() {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-primary/10 px-3 py-2.5">
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <p className="min-w-0 flex-1 text-xs leading-4 text-primary-300">
        Stay updated on your orders and unlock amazing deals. Enable notifications now!
      </p>
      <button type="button" onClick={enable} className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">
        Enable
      </button>
    </div>
  );
}
