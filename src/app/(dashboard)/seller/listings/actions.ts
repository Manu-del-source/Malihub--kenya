"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listingSchema, type ListingInput } from "@/lib/validations/listing";
import {
  createListing,
  updateListing,
  deleteListing,
  archiveListing,
  unarchiveListing,
  markListingSold,
  duplicateListing,
  ListingServiceError,
} from "@/services/listing-service";
import type { ApiResult } from "@/types";

async function requireSeller() {
  const user = (await getCurrentUser())?.user;
  if (!user) throw new ListingServiceError("You need to sign in first.");

  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!seller) throw new ListingServiceError("Complete your seller setup before listing an item.");

  return { userId: user.id, sellerId: seller.id };
}

function toResult<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  return fn()
    .then((data) => ({ success: true as const, data }))
    .catch((error) => {
      if (error instanceof ListingServiceError) {
        return { success: false as const, error: error.message };
      }
      console.error("Listing action failed", error);
      return { success: false as const, error: "Something went wrong. Please try again." };
    });
}

export async function createListingAction(
  input: ListingInput
): Promise<ApiResult<{ slug: string }>> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  return toResult(async () => {
    const { userId, sellerId } = await requireSeller();
    const product = await createListing(userId, sellerId, parsed.data);
    revalidatePath("/dashboard/seller/listings");
    revalidatePath("/search");
    return { slug: product.slug };
  });
}

export async function updateListingAction(
  productId: string,
  input: ListingInput
): Promise<ApiResult<{ slug: string }>> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  return toResult(async () => {
    const { userId } = await requireSeller();
    const product = await updateListing(productId, userId, parsed.data);
    revalidatePath("/dashboard/seller/listings");
    revalidatePath(`/products/${product.slug}`);
    return { slug: product.slug };
  });
}

export async function deleteListingAction(productId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const { userId } = await requireSeller();
    await deleteListing(productId, userId);
    revalidatePath("/dashboard/seller/listings");
    return null;
  });
}

export async function archiveListingAction(productId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const { userId } = await requireSeller();
    await archiveListing(productId, userId);
    revalidatePath("/dashboard/seller/listings");
    return null;
  });
}

export async function unarchiveListingAction(productId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const { userId } = await requireSeller();
    await unarchiveListing(productId, userId);
    revalidatePath("/dashboard/seller/listings");
    return null;
  });
}

export async function markListingSoldAction(productId: string): Promise<ApiResult<null>> {
  return toResult(async () => {
    const { userId } = await requireSeller();
    await markListingSold(productId, userId);
    revalidatePath("/dashboard/seller/listings");
    return null;
  });
}

export async function duplicateListingAction(
  productId: string
): Promise<ApiResult<{ id: string }>> {
  return toResult(async () => {
    const { userId } = await requireSeller();
    const duplicate = await duplicateListing(productId, userId);
    revalidatePath("/dashboard/seller/listings");
    return { id: duplicate.id };
  });
}
