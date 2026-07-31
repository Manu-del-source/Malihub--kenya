"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordListingView, toggleFavorite, createReport, ListingServiceError } from "@/services/listing-service";
import type { ApiResult, ReportReason } from "@/types";

/** Called client-side, once per product per browser session — see
 * components/marketplace/view-tracker.tsx. Anonymous views are allowed
 * (viewerId is nullable), so this never requires auth. */
export async function recordListingViewAction(productId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await recordListingView(productId, user?.id ?? null);
}

export async function toggleFavoriteAction(
  productId: string
): Promise<ApiResult<{ favorited: boolean }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Sign in to save favorites." };
  }

  try {
    const result = await toggleFavorite(user.id, productId);
    revalidatePath("/dashboard/buyer/wishlist");
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ListingServiceError) {
      return { success: false, error: error.message };
    }
    console.error("toggleFavoriteAction failed", error);
    return { success: false, error: "Something went wrong. Please try again." };
  }
}

export async function reportListingAction(
  productId: string,
  reason: ReportReason,
  details?: string
): Promise<ApiResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Sign in to report a listing." };
  }

  try {
    await createReport(user.id, productId, reason, details);
    return { success: true, data: null };
  } catch (error) {
    console.error("reportListingAction failed", error);
    return { success: false, error: "Something went wrong. Please try again." };
  }
}
