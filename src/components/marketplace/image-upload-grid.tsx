"use client";

import Image from "next/image";
import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import { ImagePlus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_SELLER_UPLOAD_IMAGES } from "@/lib/constants";
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
  const remaining = MAX_SELLER_UPLOAD_IMAGES - images.length;

  function handleSuccess(results: CloudinaryUploadWidgetResults) {
    const info = results.info;
    if (!info || typeof info === "string") return;

    if (!info.secure_url || !info.public_id || !info.format || !["jpg", "jpeg", "png", "webp"].includes(info.format.toLowerCase())) {
      toast.error("Please upload a JPEG, PNG, or WebP image.");
      return;
    }

    if (images.length >= MAX_SELLER_UPLOAD_IMAGES) {
      toast.error(`You can upload up to ${MAX_SELLER_UPLOAD_IMAGES} photos per product.`);
      return;
    }

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

      {remaining > 0 && (
        <CldUploadWidget
          signatureEndpoint="/api/cloudinary/sign"
          options={{
            maxFiles: remaining,
            maxFileSize: 1_000_000,
            maxImageWidth: 2000,
            maxImageHeight: 2000,
            clientAllowedFormats: ["jpg", "jpeg", "png", "webp"],
            folder: "malihub/products",
            sources: ["local", "camera"],
            multiple: true,
          }}
          onSuccess={handleSuccess}
          onError={() => toast.error("Upload failed — check the image is under 1 MB and try again.")}
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
              <span className="px-1 text-center text-[9px]">JPEG, PNG, WebP · max 1 MB</span>
            </button>
          )}
        </CldUploadWidget>
      )}
    </div>
  );
}
