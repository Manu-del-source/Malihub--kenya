import { Badge } from "@/components/ui/badge";
import type {
  OrderStatus,
  PaymentStatus,
  SellerPayoutAccountStatus,
  SellerVerificationStatus,
  SettlementStatus,
  UserRole,
} from "@prisma/client";
import { ORDER_STATUS_LABEL, isPaidOrderStatus } from "@/lib/order-status";

/**
 * Status badges for the admin area. Presentation-only helpers on top of the
 * shared Badge primitive — colors are semantic (verified/paid = cyan/primary,
 * rejected/banned = destructive, neutral states = muted) and every label
 * renders the raw enum value somewhere, so a badge can never misrepresent a
 * state the list is filtering on.
 */

const ROLE_LABEL: Record<UserRole, string> = {
  BUYER: "Buyer",
  SELLER: "Seller",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super admin",
};

export function UserRoleBadge({ role }: { role: UserRole }) {
  const variant = role === "ADMIN" || role === "SUPER_ADMIN" ? "primary" : "default";
  return <Badge variant={variant}>{ROLE_LABEL[role]}</Badge>;
}

export function AccountStatusBadge({
  isActive,
  isBanned,
}: {
  isActive: boolean;
  isBanned: boolean;
}) {
  if (isBanned) {
    return (
      <Badge className="bg-destructive/15 text-destructive" variant="default">
        Banned
      </Badge>
    );
  }
  if (!isActive) {
    return <Badge variant="default">Deactivated</Badge>;
  }
  return <Badge variant="cyan">Active</Badge>;
}

const SELLER_VERIFICATION_LABEL: Record<SellerVerificationStatus, string> = {
  UNVERIFIED: "Unverified",
  PENDING: "Pending review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export function SellerVerificationBadge({ status }: { status: SellerVerificationStatus }) {
  if (status === "VERIFIED") return <Badge variant="verified">Verified</Badge>;
  if (status === "PENDING") return <Badge variant="primary">Pending review</Badge>;
  if (status === "REJECTED") {
    return (
      <Badge variant="default" className="bg-destructive/15 text-destructive">
        Rejected
      </Badge>
    );
  }
  return <Badge variant="default">{SELLER_VERIFICATION_LABEL.UNVERIFIED}</Badge>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED" || status === "REFUNDED") {
    return (
      <Badge variant="default" className="bg-destructive/15 text-destructive">
        {ORDER_STATUS_LABEL[status]}
      </Badge>
    );
  }
  return (
    <Badge variant={isPaidOrderStatus(status) ? "primary" : "default"}>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Awaiting provider",
  PROCESSING: "Processing",
  SUCCESS: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const variant =
    status === "SUCCESS" ? "cyan" : status === "FAILED" || status === "CANCELLED" ? "default" : "primary";
  const tone = status === "FAILED" || status === "CANCELLED" ? "bg-destructive/15 text-destructive" : undefined;
  return (
    <Badge variant={variant} className={tone}>
      {PAYMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SettlementStatusBadge({ status }: { status: SettlementStatus }) {
  const label =
    status === "ELIGIBLE" ? "Payable" : status === "REVERSED" ? "Reversed" : status;
  return (
    <Badge variant={status === "SETTLED" ? "cyan" : "default"} className="uppercase tracking-wide">
      {label}
    </Badge>
  );
}

export function PayoutAccountStatusBadge({ status }: { status: SellerPayoutAccountStatus }) {
  const label = status.replace(/_/g, " ").toLowerCase();
  if (status === "ACTIVE" || status === "VERIFIED") {
    return <Badge variant="cyan">{label}</Badge>;
  }
  if (status === "REJECTED" || status === "SUSPENDED") {
    return (
      <Badge variant="default" className="bg-destructive/15 text-destructive">
        {label}
      </Badge>
    );
  }
  return <Badge variant="default">{label}</Badge>;
}
