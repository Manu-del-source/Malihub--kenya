import "server-only";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/utils";
import { notifyUser } from "@/services/notification-service";
import type { ListingInput } from "@/lib/validations/listing";
import type { Prisma, ReportReason } from "@prisma/client";

const RECENT_INQUIRY_SELECT = {
  id: true,
  lastMessageAt: true,
  buyer: { select: { profile: { select: { fullName: true } } } },
  product: { select: { title: true, slug: true } },
} satisfies Prisma.ChatSelect;

export type RecentInquiry = Prisma.ChatGetPayload<{ select: typeof RECENT_INQUIRY_SELECT }>;

export class ListingServiceError extends Error {}

async function assertOwnership(productId: string, ownerId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, ownerId: true, sellerId: true },
  });
  if (!product || product.ownerId !== ownerId) {
    throw new ListingServiceError("Listing not found or you don't have access to it.");
  }
  return product;
}

export async function createListing(
  ownerId: string,
  sellerId: string,
  input: ListingInput
) {
  const category = await prisma.category.findUnique({
    where: { slug: input.categorySlug },
    select: { id: true },
  });
  if (!category) throw new ListingServiceError("Select a valid category.");

  const isPublishing = input.status === "ACTIVE";

  return prisma.product.create({
    data: {
      ownerId,
      sellerId,
      categoryId: category.id,
      title: input.title,
      slug: slugify(input.title),
      description: input.description,
      priceCents: input.priceCents,
      isNegotiable: input.isNegotiable,
      condition: input.condition,
      brand: input.brand || null,
      quantity: input.quantity,
      contactPreference: input.contactPreference,
      county: input.county,
      subCounty: input.town,
      status: isPublishing ? "ACTIVE" : "DRAFT",
      publishedAt: isPublishing ? new Date() : null,
      images: {
        create: input.images.map((img, index) => ({
          url: img.url,
          cloudinaryId: img.cloudinaryId,
          sortOrder: index,
          isPrimary: index === 0,
        })),
      },
    },
    include: { images: true, category: true },
  });
}

export async function updateListing(
  productId: string,
  ownerId: string,
  input: ListingInput
) {
  await assertOwnership(productId, ownerId);

  const category = await prisma.category.findUnique({
    where: { slug: input.categorySlug },
    select: { id: true },
  });
  if (!category) throw new ListingServiceError("Select a valid category.");

  const existing = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { status: true, publishedAt: true },
  });
  const isPublishing = input.status === "ACTIVE";
  // Only DRAFT/ACTIVE are settable from the edit form — publishing for the
  // first time stamps publishedAt; re-saving an already-published listing
  // (e.g. a price edit) doesn't reset it.
  const nextStatus = isPublishing ? "ACTIVE" : existing.status === "ACTIVE" ? "ACTIVE" : "DRAFT";

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Replace the image set wholesale — simpler and safer than diffing,
    // and image edits are infrequent enough that this isn't a hot path.
    await tx.productImage.deleteMany({ where: { productId } });

    return tx.product.update({
      where: { id: productId },
      data: {
        categoryId: category.id,
        title: input.title,
        description: input.description,
        priceCents: input.priceCents,
        isNegotiable: input.isNegotiable,
        condition: input.condition,
        brand: input.brand || null,
        quantity: input.quantity,
        contactPreference: input.contactPreference,
        county: input.county,
        subCounty: input.town,
        status: nextStatus,
        publishedAt: existing.publishedAt ?? (nextStatus === "ACTIVE" ? new Date() : null),
        images: {
          create: input.images.map((img, index) => ({
            url: img.url,
            cloudinaryId: img.cloudinaryId,
            sortOrder: index,
            isPrimary: index === 0,
          })),
        },
      },
      include: { images: true, category: true },
    });
  });
}

/** Soft delete — status flips to REMOVED rather than an actual row delete,
 * so order history / reviews referencing this listing never orphan (see
 * ARCHITECTURE.md §6). */
export async function deleteListing(productId: string, ownerId: string) {
  await assertOwnership(productId, ownerId);
  await prisma.product.update({ where: { id: productId }, data: { status: "REMOVED" } });
}

export async function archiveListing(productId: string, ownerId: string) {
  await assertOwnership(productId, ownerId);
  await prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
}

export async function unarchiveListing(productId: string, ownerId: string) {
  await assertOwnership(productId, ownerId);
  await prisma.product.update({
    where: { id: productId },
    data: { status: "ACTIVE", publishedAt: new Date() },
  });
}

export async function markListingSold(productId: string, ownerId: string) {
  await assertOwnership(productId, ownerId);
  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: "SOLD" },
    select: { title: true, slug: true },
  });

  const favoriters = await prisma.wishlist.findMany({
    where: { productId },
    select: { userId: true },
  });
  await Promise.all(
    favoriters.map((f: { userId: string }) =>
      notifyUser({
        userId: f.userId,
        type: "LISTING_SOLD",
        title: "A saved listing just sold",
        body: `"${product.title}" — one of your favorites — has been marked as sold.`,
        linkUrl: `/products/${product.slug}`,
      }).catch((error) => console.error("Failed to send LISTING_SOLD notification", error))
    )
  );
}

export async function duplicateListing(productId: string, ownerId: string) {
  const original = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: true },
  });
  if (!original || original.ownerId !== ownerId) {
    throw new ListingServiceError("Listing not found or you don't have access to it.");
  }

  return prisma.product.create({
    data: {
      ownerId: original.ownerId,
      sellerId: original.sellerId,
      categoryId: original.categoryId,
      title: original.title,
      slug: slugify(original.title),
      description: original.description,
      priceCents: original.priceCents,
      isNegotiable: original.isNegotiable,
      condition: original.condition,
      brand: original.brand,
      quantity: original.quantity,
      contactPreference: original.contactPreference,
      county: original.county,
      subCounty: original.subCounty,
      status: "DRAFT",
      images: {
        create: original.images.map((img: { url: string; cloudinaryId: string }, index: number) => ({
          url: img.url,
          cloudinaryId: img.cloudinaryId,
          sortOrder: index,
          isPrimary: index === 0,
        })),
      },
    },
    include: { images: true, category: true },
  });
}

const VIEW_DEDUPE_WINDOW_MINUTES = 30;

/** Logs a view + bumps the fast counter, deduped per logged-in viewer
 * within a time window. Anonymous views are deduped client-side instead
 * (see components/marketplace/view-tracker.tsx) since there's no reliable
 * server-side identity to key off without fingerprinting. */
export async function recordListingView(productId: string, viewerId: string | null) {
  if (viewerId) {
    const recent = await prisma.listingView.findFirst({
      where: {
        productId,
        viewerId,
        createdAt: { gte: new Date(Date.now() - VIEW_DEDUPE_WINDOW_MINUTES * 60_000) },
      },
      select: { id: true },
    });
    if (recent) return;
  }

  await prisma.$transaction([
    prisma.listingView.create({ data: { productId, viewerId } }),
    prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } }),
  ]);
}

export async function toggleFavorite(userId: string, productId: string) {
  const existing = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.wishlist.delete({ where: { id: existing.id } }),
      prisma.product.update({ where: { id: productId }, data: { favoriteCount: { decrement: 1 } } }),
    ]);
    return { favorited: false };
  }

  await prisma.$transaction([
    prisma.wishlist.create({ data: { userId, productId } }),
    prisma.product.update({ where: { id: productId }, data: { favoriteCount: { increment: 1 } } }),
  ]);

  // Fire-and-forget: notify the listing owner, but never let a
  // notification failure break the favorite action itself.
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, slug: true, ownerId: true },
  });
  if (product && product.ownerId !== userId) {
    notifyUser({
      userId: product.ownerId,
      type: "NEW_FAVORITE",
      title: "Someone favorited your listing",
      body: `Your listing "${product.title}" was just saved to a buyer's favorites.`,
      linkUrl: `/products/${product.slug}`,
    }).catch((error) => console.error("Failed to send NEW_FAVORITE notification", error));
  }

  return { favorited: true };
}

export async function createReport(
  reporterId: string,
  productId: string,
  reason: ReportReason,
  details?: string
) {
  await prisma.report.create({
    data: { reporterId, productId, reason, details: details || null },
  });
}

export async function getSellerStats(userId: string) {
  const seller = await prisma.seller.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!seller) {
    throw new ListingServiceError("No seller profile found for this account.");
  }
  const sellerId = seller.id;

  const [totalListings, activeListings, drafts, sold, viewsAgg, recentInquiries] =
    await Promise.all([
      prisma.product.count({ where: { sellerId, status: { not: "REMOVED" } } }),
      prisma.product.count({ where: { sellerId, status: "ACTIVE" } }),
      prisma.product.count({ where: { sellerId, status: "DRAFT" } }),
      prisma.product.count({ where: { sellerId, status: "SOLD" } }),
      prisma.product.aggregate({
        where: { sellerId, status: { not: "REMOVED" } },
        _sum: { viewCount: true },
      }),
      // Chat.sellerId points at the seller's *User* row (a person can chat
      // as a seller without a Seller business profile existing yet), not
      // at Seller.id — hence querying by `userId` here, not `sellerId`.
      prisma.chat.findMany({
        where: { sellerId: userId },
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        select: RECENT_INQUIRY_SELECT,
      }),
    ]);

  return {
    totalListings,
    activeListings,
    drafts,
    sold,
    totalViews: viewsAgg._sum.viewCount ?? 0,
    recentInquiries,
  };
}
