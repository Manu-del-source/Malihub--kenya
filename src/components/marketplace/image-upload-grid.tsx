"use client";

import Image from "next/image";
import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import { ImagePlus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_LISTING_IMAGES } from "@/lib/constants";
import type { ListingInput } from "@/lib/validations/listing";
import { cn } from "@/utils";

type ListingImage = ListingInput["images"][number];

export function ImageUploadGrid({
  images,
  onChange,
}: {
  images: ListingImage[];
  onChange: (images: ListingImage[]) => void;
}) {
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  const remaining = MAX_LISTING_IMAGES - images.length;

  function handleSuccess(results: CloudinaryUploadWidgetResults) {
    const info = results.info;
    if (!info || typeof info === "string") return;

    onChange([...images, { url: info.secure_url, cloudinaryId: info.public_id }]);
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
        <div
          key={image.cloudinaryId}
          className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
        >
          <Image
            src={image.url}
            alt=""
            fill
            sizes="160px"
            className="object-cover"
          />
          {index === 0 && (
            <span className="glass-sm absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] text-primary-400">
              Cover
            </span>
          )}
          <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 via-transparent to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            {index !== 0 && (
              <button
                type="button"
                onClick={() => handleMakeCover(index)}
                aria-label="Make cover photo"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:text-primary-400"
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRemove(index)}
              aria-label="Remove photo"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {remaining > 0 && uploadPreset && (
        <CldUploadWidget
          uploadPreset={uploadPreset}
          options={{ maxFiles: remaining, sources: ["local", "camera"], multiple: true }}
          onSuccess={handleSuccess}
          onError={() => toast.error("Upload failed — please try again.")}
        >
          {({ open }) => (
            <button
              type="button"
              onClick={() => open()}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary-400"
              )}
            >
              <ImagePlus className="h-5 w-5" aria-hidden />
              <span className="text-[11px]">Add photo</span>
            </button>
          )}
        </CldUploadWidget>
      )}
    </div>
  );
}
