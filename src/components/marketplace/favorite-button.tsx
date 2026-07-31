"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { toggleFavoriteAction } from "@/app/(marketplace)/actions";
import { cn } from "@/utils";

export function FavoriteButton({
  productId,
  initialFavorited,
  className,
  size = "sm",
}: {
  productId: string;
  initialFavorited: boolean;
  className?: string;
  size?: "sm" | "lg";
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const next = !favorited;
    setFavorited(next); // optimistic

    startTransition(async () => {
      const result = await toggleFavoriteAction(productId);
      if (!result.success) {
        setFavorited(!next); // revert
        if (result.error.includes("Sign in")) {
          toast.error("Sign in to save favorites.");
          router.push("/login");
        } else {
          toast.error(result.error);
        }
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
      className={cn(
        "glass flex items-center justify-center rounded-full text-foreground transition-colors hover:text-destructive",
        size === "sm" ? "h-9 w-9" : "h-12 w-12",
        favorited && "text-destructive",
        className
      )}
    >
      <Heart className={cn(size === "sm" ? "h-4 w-4" : "h-5 w-5", favorited && "fill-current")} aria-hidden />
    </button>
  );
}
