"use client";

import { useRef, useState } from "react";
import { ImagePlus, Send, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import { EmojiPicker } from "@/components/messaging/emoji-picker";
import { MAX_MESSAGE_LENGTH } from "@/lib/validations/chat";
import { uploadImageFile } from "@/lib/client-image-upload";
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
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSend() {
    const trimmed = content.trim();
    if (isUploading || (!trimmed && !pendingImage)) return;
    setIsSending(true);
    try {
      await onSend({ content: trimmed || undefined, imageUrl: pendingImage || undefined });
      setContent("");
      setPendingImage(null);
      textareaRef.current?.focus();
    } catch {
      toast.error("Message could not be sent. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsUploading(true);
    try {
      const uploaded = await uploadImageFile(file, "message");
      setPendingImage(uploaded.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (disabled) {
    return <div className="border-t border-border p-4 text-center text-sm text-muted-foreground">{disabledReason ?? "You can't send messages in this conversation."}</div>;
  }

  return (
    <div className="border-t border-border p-3">
      {pendingImage && (
        <div className="relative mb-2 h-20 w-20">
          <Image src={pendingImage} alt="" fill sizes="80px" className="rounded-lg object-cover" />
          <button type="button" onClick={() => setPendingImage(null)} aria-label="Remove image" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose message image" onChange={handleImageSelected} disabled={isUploading || isSending} />

      <div className="flex items-end gap-2">
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading || isSending} aria-label="Attach image" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4.5 w-4.5" />}
        </button>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => { setContent(e.target.value); onTyping(); }}
          onKeyDown={handleKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          placeholder="Write a message…"
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background/60 px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <EmojiPicker onSelect={(emoji) => setContent((c) => c + emoji)} />
        <button type="button" onClick={() => void handleSend()} disabled={isSending || isUploading || (!content.trim() && !pendingImage)} aria-label="Send message" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity", (isSending || isUploading || (!content.trim() && !pendingImage)) && "opacity-40")}>
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
