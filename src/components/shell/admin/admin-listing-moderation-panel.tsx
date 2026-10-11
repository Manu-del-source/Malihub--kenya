"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, RotateCcw, ShieldX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteAdminListingAction, moderateListingAction } from "@/app/(dashboard)/admin/actions";
import type { ModerationAction } from "@/services/admin-service";
import type { ListingStatus } from "@prisma/client";

/**
 * Moderation actions for one listing. Actions are only rendered for
 * transitions the service permits from the listing's current status — the
 * same table lives server-side, and it, not this component, is the rule.
 * Every choice goes through the Server Action (which re-checks the admin
 * session/role) and lands in the audit log; no action touches money.
 */
export function AdminListingModerationPanel({
  productId,
  status,
  title,
  isSuperAdmin = false,
}: {
  productId: string;
  status: ListingStatus;
  title: string;
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<ModerationAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const can = (action: ModerationAction): boolean => {
    switch (action) {
      case "approve":
        return status === "PENDING_REVIEW" || status === "DRAFT";
      case "reject":
        return status === "PENDING_REVIEW" || status === "SUSPENDED";
      case "suspend":
        return status === "ACTIVE" || status === "SOLD";
      case "restore":
        return status === "SUSPENDED" || status === "REMOVED";
    }
  };

  function run(action: ModerationAction, success: string) {
    setConfirming(null);
    startTransition(async () => {
      const result = await moderateListingAction({
        productId,
        action,
        note: note.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error ?? "That action could not be completed.");
        return;
      }
      toast.success(success);
      setNote("");
      router.refresh();
    });
  }

  const nothingApplies = !can("approve") && !can("reject") && !can("suspend") && !can("restore");

  function removeListing() {
    setConfirmDelete(false);
    startTransition(async () => {
      const result = await deleteAdminListingAction({ productId });
      if (!result.success) {
        toast.error(result.error ?? "Could not delete this listing.");
        return;
      }
      toast.success(`“${result.data.title}” removed from the marketplace.`);
      router.push("/admin/listings");
      router.refresh();
    });
  }

  return (
    <section aria-label="Listing moderation" className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-medium">Moderation</h2>
        <span className="text-xs text-muted-foreground">
          current status: <span className="font-mono uppercase">{status}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Moderation changes listing visibility while preserving order history and reviews. Super-admin deletion also uses the REMOVED state rather than erasing the database record.
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-muted-foreground">Note to the seller (optional)</span>
        <Input
          value={note}
          maxLength={300}
          disabled={isPending}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Included in the seller notification and the audit entry"
          className="mt-1.5"
        />
      </label>

      {nothingApplies ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No moderation action applies to this status.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {can("approve") && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run("approve", "Listing approved and published.")}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Approve & publish
            </Button>
          )}
          {can("restore") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => run("restore", "Listing restored to active.")}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Restore
            </Button>
          )}
          {can("suspend") && renderConfirmButton(
            "suspend",
            "Suspend — hide from the marketplace",
            "Listing suspended.",
            <Ban className="h-4 w-4" aria-hidden />
          )}
          {can("reject") && renderConfirmButton(
            "reject",
            "Reject — remove the listing",
            "Listing rejected and removed.",
            <ShieldX className="h-4 w-4" aria-hidden />
          )}
        </div>
      )}

      {isSuperAdmin && status !== "REMOVED" && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Super-admin action</p>
          {confirmDelete ? (
            <div className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm font-medium">Remove “{title}” from the marketplace?</p>
              <p className="mt-1 text-xs text-muted-foreground">It will no longer be listed publicly. Order and review history will be preserved.</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={isPending} onClick={removeListing} className="bg-destructive text-white hover:bg-destructive/90">
                  {isPending ? "Removing…" : "Confirm delete"}
                </Button>
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setConfirmDelete(true)} className="mt-2 border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete product
            </Button>
          )}
        </div>
      )}
    </section>
  );

  function renderConfirmButton(
    action: ModerationAction,
    label: string,
    success: string,
    icon: React.ReactNode
  ) {
    if (confirming === action) {
      return (
        <div
          key={action}
          className="flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm"
        >
          {label === "Reject — remove the listing" ? `Remove “${title}”?` : "Confirm this action?"}
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(action, success)}
            className="h-8 bg-destructive/15 text-destructive hover:bg-destructive/20"
          >
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      );
    }
    return (
      <Button
        key={action}
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => setConfirming(action)}
        className="border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10"
      >
        {icon}
        {label}
      </Button>
    );
  }
}
