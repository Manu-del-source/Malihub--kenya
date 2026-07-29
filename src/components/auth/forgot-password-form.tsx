"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, MailCheck } from "lucide-react";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/lib/validations/auth";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(input: ForgotPasswordInput) {
    const result = await forgotPasswordAction(input);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setSentTo(result.data.email);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan/15 text-cyan">
          <MailCheck className="h-5 w-5" aria-hidden />
        </div>
        <p className="text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{sentTo}</span>,
          a password reset link is on its way. Check your inbox (and spam folder).
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <FormField id="email" label="Email address" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          invalid={!!errors.email}
          {...register("email")}
        />
      </FormField>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Send reset link"}
        {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
