import { Badge } from "@/components/ui/badge";
import type { ListingStatus } from "@/types";

const STATUS_STYLES: Record<ListingStatus, { label: string; variant: "default" | "primary" | "cyan" }> = {
  DRAFT: { label: "Draft", variant: "default" },
  PENDING_REVIEW: { label: "Pending review", variant: "default" },
  ACTIVE: { label: "Active", variant: "cyan" },
  SOLD: { label: "Sold", variant: "primary" },
  ARCHIVED: { label: "Archived", variant: "default" },
  SUSPENDED: { label: "Suspended", variant: "default" },
  REMOVED: { label: "Removed", variant: "default" },
};

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  // Non-null assertion is safe: the `??` fallback guarantees a value even
  // if `status` were somehow outside the enum. (Also see: this file's
  // errors before `prisma generate` runs are compounded by ListingStatus
  // itself resolving to a loose type until the client is generated.)
  const config = (STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT)!;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
