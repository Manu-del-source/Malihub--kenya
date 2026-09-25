"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, KeyRound, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import {
  resendVerificationAction,
  verifyEmailWithCodeAction,
} from "@/app/(auth)/actions";
import { verifyEmailCodeSchema, type VerifyEmailCodeInput } from "@/lib/validations/auth";

/**
 * Email verification, with BOTH paths the auth service can offer.
 *
 * ─── Why there are two ─────────────────────────────────────────────────────
 * Verification LINKS match the flow MaliHub's users already had, so they are the
 * primary path — but on a Neon branch they require a custom email provider to be
 * configured in the Console. Verification CODES work with the shared provider
 * that is available immediately. `resendVerificationAction` asks for a link and
 * falls back to a code when the service reports links are not enabled, then tells
 * this component which one actually went out.
 *
 * So the panel adapts to the branch's configuration instead of hard-coding an
 * assumption about it: on a shared-provider branch the person is never told to
 * look for a link that was never sent, and on a custom-provider branch they are
 * not asked to type a code they were never given.
 */

const COOLDOWN_SECONDS = 45;

type Mode = "link" | "code";

export function VerifyEmailPanel({ email }: { email: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("link");
  const [cooldown, setCooldown] = useState(0);
  const [isSending, setIsSending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VerifyEmailCodeInput>({
    resolver: zodResolver(verifyEmailCodeSchema),
    defaultValues: { email, code: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  /**
   * Asks for a verification message and switches to whichever path the service
   * actually fulfilled. Shared by the resend button and "enter a code instead",
   * because both need the same answer: link, or code?
   */
  async function requestVerification(preferCode: boolean) {
    setIsSending(true);
    const result = await resendVerificationAction(email);
    setIsSending(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    setCooldown(COOLDOWN_SECONDS);

    if (result.data.method === "code") {
      // Links are not enabled on this branch, so showing "click the link in your
      // email" would leave the person waiting for something that was never sent.
      setMode("code");
      toast.success("We sent a 6-digit code to your email.");
      return;
    }

    if (preferCode) {
      // They asked for a code and the service sent a link instead. Say so rather
      // than silently switching the screen to an input box for a code that does
      // not exist.
      toast.success("We sent a verification link instead — check your inbox.");
      setMode("link");
      return;
    }

    setMode("link");
    toast.success("Verification email resent.");
  }

  async function onSubmit(input: VerifyEmailCodeInput) {
    const result = await verifyEmailWithCodeAction({ ...input, email });

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success("Email verified.");
    router.push(result.data.redirectTo);
  }

  if (mode === "code") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-1">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan/15 text-cyan">
            <KeyRound className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Enter the 6-digit code we sent to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <FormField id="code" label="Verification code" error={errors.code?.message}>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="123456"
              // Centred, letter-spaced and monospaced: a one-time code is read
              // digit by digit against an email in another window.
              className="text-center font-mono text-lg tracking-[0.4em]"
              invalid={!!errors.code}
              {...register("code")}
            />
          </FormField>

          <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Verifying…" : "Verify email"}
            {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
          </Button>
        </form>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void requestVerification(false)}
            disabled={isSending || cooldown > 0}
            className="w-full"
          >
            {cooldown > 0
              ? `Resend available in ${cooldown}s`
              : isSending
                ? "Sending…"
                : "Resend code"}
          </Button>
          <button
            type="button"
            onClick={() => setMode("link")}
            className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Use a verification link instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan/15 text-cyan">
        <MailCheck className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Click the link in the email to verify your account, then you&rsquo;ll be taken
        straight to setting up your profile.
      </p>

      <div className="flex w-full flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void requestVerification(false)}
          disabled={isSending || cooldown > 0}
          className="w-full"
        >
          {cooldown > 0
            ? `Resend available in ${cooldown}s`
            : isSending
              ? "Sending…"
              : "Resend verification email"}
        </Button>
        <button
          type="button"
          onClick={() => void requestVerification(true)}
          disabled={isSending}
          className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          Didn&rsquo;t get a link? Enter a code instead
        </button>
      </div>
    </div>
  );
}
