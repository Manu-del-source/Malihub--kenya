"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Smileys", emojis: ["😀", "😂", "😊", "😍", "🥰", "😉", "😎", "🤔", "😅", "😢", "😭", "😡"] },
  { label: "Gestures", emojis: ["👍", "👎", "🙏", "👋", "🤝", "💪", "🙌", "👏"] },
  { label: "Marketplace", emojis: ["💰", "💵", "🛍️", "📦", "🚗", "🏠", "📱", "✅", "❌", "⭐"] },
  { label: "Hearts", emojis: ["❤️", "🔥", "🎉", "👀"] },
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add emoji"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Smile className="h-4.5 w-4.5" aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="glass absolute bottom-full right-0 z-20 mb-2 w-64 rounded-xl p-3"
            >
              {EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="mb-2 last:mb-0">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {group.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onSelect(emoji);
                          setOpen(false);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-muted"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
