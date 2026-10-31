"use client";

export type ImageUploadPurpose = "product" | "message";
export type UploadedImage = { url: string; publicId: string };

/** Uploads to MaliHub's authenticated sanitizer; never uploads directly to Cloudinary. */
export async function uploadImageFile(file: File, purpose: ImageUploadPurpose): Promise<UploadedImage> {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", file);
  const response = await fetch("/api/uploads/images", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: { url?: string; publicId?: string }; error?: string }
    | null;
  if (!response.ok || !payload?.success || !payload.data?.url || !payload.data.publicId) {
    throw new Error(payload?.error || "Image upload failed. Please try again.");
  }
  return { url: payload.data.url, publicId: payload.data.publicId };
}
