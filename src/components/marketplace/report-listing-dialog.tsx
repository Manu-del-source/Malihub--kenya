"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { reportListingAction } from "@/app/(marketplace)/actions";
import type { ReportReason } from "@/types";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "SCAM", label: "Suspected scam" },
  { value: "COUNTERFEIT", label: "Counterfeit item" },
  { value: "PROHIBITED_ITEM", label: "Prohibited item" },
  { value: "MISLEADING", label: "Misleading listing" },
  { value: "OFFENSIVE", label: "Offensive content" },
  { value: "OTHER", label: "Other" },
];

export function ReportListingDialog({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("SCAM");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    const result = await reportListingAction(productId, reason, details);
    setIsSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Thanks — our team will review this listing.");
    setOpen(false);
    setDetails("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
        >
          <Flag className="h-3.5 w-3.5" aria-hidden />
          Report listing
        </button>
      </DialogTrigger>
      <DialogContent title="Report this listing" description="Help us keep MaliHub safe.">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-reason" className="text-sm font-medium text-foreground/90">
              Reason
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              className="h-11 w-full rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-details" className="text-sm font-medium text-foreground/90">
              Details (optional)
            </label>
            <textarea
              id="report-details"
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything else that would help us review this?"
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Submitting…" : "Submit report"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
