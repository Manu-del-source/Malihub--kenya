"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import {
  sendVerificationCodeAction,
  verifyEmailWithCodeAction,
} from "@/app/(auth)/actions";
import { verifyEmailCodeSchema, type VerifyEmailCodeInput } from "@/lib/validations/auth";
import {
  runSendCode,
  type SendOutcome,
} from "@/components/auth/verify-email-flow";

/** Email verification uses the 6-digit code sent to the user. */

export function VerifyEmailPanel({ email, redirectTo }: { email: string; redirectTo?: string }) {
  const router = useRouter();
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

  function applyOutcome(outcome: SendOutcome) {
    if (!outcome.ok) {
      // Stay on the current screen: nothing was sent, so do not pretend it was.
      toast.error(outcome.error);
      return;
    }
    setCooldown(outcome.cooldown);
    toast.success(outcome.message);
  }

  /** Resend the verification code. */
  async function requestCode() {
    setIsSending(true);
    const outcome = await runSendCode(sendVerificationCodeAction, email);
    setIsSending(false);
    applyOutcome(outcome);
  }

  async function onSubmit(input: VerifyEmailCodeInput) {
    const result = await verifyEmailWithCodeAction({ ...input, email }, redirectTo);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success("Email verified.");
    router.push(result.data.redirectTo);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4 }}
        className="flex flex-col items-center gap-3 py-1"
      >
        <motion.div
          animate={{ y: [0, -3, 0], scale: [1, 1.035, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-cyan/15 text-cyan"
        >
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-cyan/25"
            animate={{ scale: [1, 1.22], opacity: [0.55, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
          />
          <KeyRound className="relative h-6 w-6" aria-hidden />
        </motion.div>
        <p className="text-center text-sm text-muted-foreground">
          Enter the 6-digit code we sent to{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </p>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.4 }}
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField id="code" label="Verification code" error={errors.code?.message}>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            // Keep the field empty: the user enters the code received by email.
            className="text-center font-mono text-lg tracking-[0.4em] placeholder:tracking-normal"
            invalid={!!errors.code}
            {...register("code")}
          />
        </FormField>

        <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Verifying…" : "Verify email"}
          {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
      </motion.form>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.24, duration: 0.4 }}
        className="flex flex-col gap-2"
      >
        <Button
          type="button"
          variant="secondary"
          onClick={() => void requestCode()}
          disabled={isSending || cooldown > 0}
          className="w-full"
        >
          {cooldown > 0
            ? `Resend available in ${cooldown}s`
            : isSending
              ? "Sending…"
              : "Resend code"}
        </Button>
      </motion.div>
    </motion.div>
  );
}
