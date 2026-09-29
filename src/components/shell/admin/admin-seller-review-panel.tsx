"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldAlert, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  rejectSellerAction,
  resetSellerVerificationAction,
  verifySellerAction,
} from "@/app/(dashboard)/admin/actions";
import type { SellerVerificationStatus } from "@prisma/client";

/**
 * Verification decisions for one seller.
 *
 * The panel sends only the seller id and an optional note — status, actor,
 * and whether the transition is legal are decided server-side (guard +
 * service). Buttons appear only for transitions the service allows from the
 * seller's CURRENT status; that's UX, not enforcement — reloading after any
 * concurrent change re-derives them from the database.
 */
export function AdminSellerReviewPanel({
  sellerId,
  status,
  businessName,
}: {
  sellerId: string;
  status: SellerVerificationStatus;
  businessName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"reject" | "unverify" | null>(null);

  const canVerify = status === "UNVERIFIED" || status === "PENDING" || status === "REJECTED";
  const canReject = status === "UNVERIFIED" || status === "PENDING" || status === "VERIFIED";
  const canReset = status === "VERIFIED" || status === "REJECTED";

  function run(action: () => Promise<{ success: boolean; error?: string }>, success: string) {
    setConfirming(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        toast.error(result.error ?? "That action could not be completed.");
        return;
      }
      toast.success(success);
      setNote("");
      router.refresh();
    });
  }

  const trimmedNote = note.trim() || undefined;

  return (
    <section
      aria-label="Seller verification"
      className="glass rounded-2xl p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-medium">Verification decision</h2>
        <span className="text-xs text-muted-foreground">
          current status: <span className="font-mono uppercase">{status}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Review {businessName}&rsquo;s profile and documents, then record a decision. The seller is
        notified in-app, and the decision is written to the audit log.
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-muted-foreground">Note for the seller (optional)</span>
        <Input
          value={note}
          maxLength={300}
          disabled={isPending}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. documents match the registered business"
          className="mt-1.5"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {canVerify && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => verifySellerAction({ sellerId, note: trimmedNote }), "Seller verified.")
            }
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Verify seller
          </Button>
        )}
        {canReject &&
          (confirming === "reject" ? (
            <div className="flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm">
              Reject {businessName}?
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => rejectSellerAction({ sellerId, note: trimmedNote }),
                    "Seller rejected."
                  )
                }
                className="h-8 bg-destructive/15 text-destructive hover:bg-destructive/20"
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming("reject")}
              className="border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden />
              Reject
            </Button>
          ))}
        {canReset &&
          (confirming === "unverify" ? (
            <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
              Reset to unverified?
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() =>
                  run(
                    () =>
                      resetSellerVerificationAction({ sellerId, note: trimmedNote }),
                    "Verification reset."
                  )
                }
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setConfirming("unverify")}
              className="text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset to unverified
            </Button>
          ))}
        {!canVerify && !canReject && !canReset && (
          <p className="text-sm text-muted-foreground">No transitions apply to this status.</p>
        )}
      </div>
    </section>
  );
}
