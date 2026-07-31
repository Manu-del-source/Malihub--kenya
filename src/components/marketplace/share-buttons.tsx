"use client";

import { Share2, Link as LinkIcon, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export function ShareButtons({ title, url }: { title: string; url: string }) {
  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // user cancelled — no-op
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleShare}
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary-400"
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
        Share
      </button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary-400"
      >
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
      </a>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          toast.success("Link copied to clipboard");
        }}
        aria-label="Copy link"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary-400"
      >
        <LinkIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
