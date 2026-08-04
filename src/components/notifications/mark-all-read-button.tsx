"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction } from "@/app/(dashboard)/notifications/actions";

export function MarkAllReadButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? "Marking…" : "Mark all as read"}
    </Button>
  );
}
