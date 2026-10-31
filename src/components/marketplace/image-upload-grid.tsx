"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Star, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MAX_SELLER_UPLOAD_IMAGES } from "@/lib/constants";
import type { ListingInput } from "@/lib/validations/listing";
import { uploadImageFile } from "@/lib/client-image-upload";
import { cn } from "@/utils";

type ListingImage = ListingInput["images"][number];

export function ImageUploadGrid({
  images,
  onChange,
}: {
  images: ListingImage[];
  onChange: (images: ListingImage[]) => void;
}) {
  const remaining = MAX_SELLER_UPLOAD_IMAGES - images.length;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    if (selected.length > remaining) {
      toast.error(`You can add only ${remaining} more photo(s) to this product.`);
      return;
    }

    setIsUploading(true);
    const uploaded: ListingImage[] = [];
    try {
      for (const file of selected) {
        try {
          const result = await uploadImageFile(file, "product");
          uploaded.push({ url: result.url, cloudinaryId: result.publicId });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Image upload failed.");
        }
      }
      if (uploaded.length) onChange([...images, ...uploaded]);
    } finally {
      setIsUploading(false);
    }
  }

  function handleRemove(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  function handleMakeCover(index: number) {
    if (index === 0) return;
    const next = [...images];
    const [chosen] = next.splice(index, 1);
    if (chosen) next.unshift(chosen);
    onChange(next);
  }

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {images.map((image, index) => (
        <div key={image.cloudinaryId} className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
          <Image src={image.url} alt="" fill sizes="160px" className="object-cover" />
          {index === 0 && (
            <span className="glass-sm absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] text-primary-400">Cover</span>
          )}
          <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 via-transparent to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            {index !== 0 && (
              <button type="button" onClick={() => handleMakeCover(index)} aria-label="Make cover photo" className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:text-primary-400">
                <Star className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={() => handleRemove(index)} aria-label="Remove photo" className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {remaining > 0 && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            aria-label="Choose product photos"
            onChange={handleFilesSelected}
            disabled={isUploading}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className={cn("flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary-400", isUploading && "cursor-wait opacity-60")}
          >
            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
            <span className="text-[11px]">{isUploading ? "Uploading…" : "Add photo"}</span>
            <span className="px-1 text-center text-[9px]">JPEG, PNG, WebP · max 1 MB</span>
          </button>
        </>
      )}
    </div>
  );
}
