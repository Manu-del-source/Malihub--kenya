import {
  MessageCircle, Heart, CheckCircle2, ShieldCheck, ShieldX, Star, CreditCard, Package, Info,
  type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@/types";

export const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  NEW_MESSAGE: MessageCircle,
  NEW_FAVORITE: Heart,
  LISTING_SOLD: CheckCircle2,
  LISTING_APPROVED: ShieldCheck,
  LISTING_REJECTED: ShieldX,
  NEW_REVIEW: Star,
  PAYMENT_UPDATE: CreditCard,
  ORDER_UPDATE: Package,
  WISHLIST_ALERT: Heart,
  LISTING_STATUS: Info,
  SYSTEM: Info,
};
