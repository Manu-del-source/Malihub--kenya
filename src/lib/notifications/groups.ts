import type { NotificationType } from "@prisma/client";

/** Message Centre inboxes, each backed by a set of notification types. */
export const NOTIFICATION_GROUPS = {
  system: { label: "System Message", types: ["SYSTEM", "LISTING_STATUS", "LISTING_APPROVED", "LISTING_REJECTED", "WISHLIST_ALERT", "NEW_FAVORITE"] },
  orders: { label: "Order Updates", types: ["ORDER_UPDATE", "PAYMENT_UPDATE", "LISTING_SOLD"] },
  promotions: { label: "Promotions", types: ["PROMOTION"] },
  comments: { label: "Comments", types: ["NEW_REVIEW"] },
} as const satisfies Record<string, { label: string; types: readonly NotificationType[] }>;

export type NotificationGroupKey = keyof typeof NOTIFICATION_GROUPS;

export function isGroupKey(value: string | undefined): value is NotificationGroupKey {
  return !!value && value in NOTIFICATION_GROUPS;
}
