"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/utils";

const MAX_SIZE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The file goes to `POST /api/avatar/upload` — a server-side, session-
 * authenticated Cloudinary upload (no Supabase, no browser-held credentials).
 * The client-side checks below are UX only; the route re-validates size and
 * magic bytes authoritatively and generates the storage path itself.
 */
async function uploadAvatar(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("avatar", file);

  const response = await fetch("/api/avatar/upload", { method: "POST", body: formData });
  const payload = (await response.json().catch(() => null)) as
    | { success: boolean; error?: string; data?: { url: string } }
    | null;

  if (!response.ok || !payload?.success || !payload.data?.url) {
    throw new Error(payload?.error ?? `Upload failed (${response.status})`);
  }
  return payload.data.url;
}

/**
 * `userId` is deliberately NOT a prop any more: the upload route derives the
 * owner from the verified session, so the client never tells the server whose
 * avatar folder to write to.
 */
export function AvatarUpload({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(value || null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error("Image must be under 3MB.");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setIsUploading(true);

    try {
      const url = await uploadAvatar(file);
      onChange(url);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      console.error(error);
      // A `TypeError` is a network failure (fetch couldn't complete) — show
      // the friendly copy. Anything else is the server's own message
      // (validation, rate limit, storage hiccup), safe to surface as-is.
      toast.error(
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : "Couldn't upload that photo — please try again."
      );
      setPreviewUrl(value || null);
    } finally {
      setIsUploading(false);
    }
  }

  function handleRemove() {
    setPreviewUrl(null);
    onChange("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted",
          isUploading && "opacity-60"
        )}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URLs aren't compatible with next/image
          <img src={previewUrl} alt="Profile preview" className="h-full w-full object-cover" />
        ) : (
          <Camera className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40">
            <Loader2 className="h-5 w-5 animate-spin text-foreground" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary-400"
          >
            {previewUrl ? "Change photo" : "Upload photo"}
          </button>
          {previewUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isUploading}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              <X className="h-3 w-3" aria-hidden />
              Remove
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Optional. JPEG, PNG or WebP, up to 3MB.</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Upload profile photo"
      />
    </div>
  );
}
