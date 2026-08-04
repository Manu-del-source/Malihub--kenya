"use client";

import { useRef, useState } from "react";
import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import { ImagePlus, Send, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import { EmojiPicker } from "@/components/messaging/emoji-picker";
import { MAX_MESSAGE_LENGTH } from "@/lib/validations/chat";
import { cn } from "@/utils";

export function MessageInput({
  onSend,
  onTyping,
  disabled,
  disabledReason,
}: {
  onSend: (input: { content?: string; imageUrl?: string }) => Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [content, setContent] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed && !pendingImage) return;

    setIsSending(true);
    await onSend({ content: trimmed || undefined, imageUrl: pendingImage || undefined });
    setIsSending(false);
    setContent("");
    setPendingImage(null);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleImageUploaded(results: CloudinaryUploadWidgetResults) {
    const info = results.info;
    if (!info || typeof info === "string") return;
    setPendingImage(info.secure_url);
  }

  if (disabled) {
    return (
      <div className="border-t border-border p-4 text-center text-sm text-muted-foreground">
        {disabledReason ?? "You can't send messages in this conversation."}
      </div>
    );
  }

  return (
    <div className="border-t border-border p-3">
      {pendingImage && (
        <div className="relative mb-2 h-20 w-20">
          <Image src={pendingImage} alt="" fill sizes="80px" className="rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            aria-label="Remove image"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {uploadPreset && (
          <CldUploadWidget
            uploadPreset={uploadPreset}
            options={{ maxFiles: 1, sources: ["local", "camera"] }}
            onSuccess={handleImageUploaded}
            onError={() => toast.error("Image upload failed.")}
          >
            {({ open }) => (
              <button
                type="button"
                onClick={() => open()}
                aria-label="Attach image"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ImagePlus className="h-4.5 w-4.5" />
              </button>
            )}
          </CldUploadWidget>
        )}

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            onTyping();
          }}
          onKeyDown={handleKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          placeholder="Write a message…"
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background/60 px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <EmojiPicker onSelect={(emoji) => setContent((c) => c + emoji)} />

        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || (!content.trim() && !pendingImage)}
          aria-label="Send message"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
            (isSending || (!content.trim() && !pendingImage)) && "opacity-40"
          )}
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
