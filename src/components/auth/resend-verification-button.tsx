"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/app/(auth)/actions";

const COOLDOWN_SECONDS = 45;

export function ResendVerificationButton({ email }: { email: string }) {
  const [cooldown, setCooldown] = useState(0);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleResend() {
    setIsSending(true);
    const result = await resendVerificationAction(email);
    setIsSending(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Verification email resent.");
    setCooldown(COOLDOWN_SECONDS);
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleResend}
      disabled={isSending || cooldown > 0}
      className="w-full"
    >
      {cooldown > 0 ? `Resend available in ${cooldown}s` : isSending ? "Sending…" : "Resend verification email"}
    </Button>
  );
}
