"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";

/**
 * @param token the one-time reset token from `/reset-password?token=…`.
 *   The auth service consumes it directly, so it is threaded through to the
 *   action rather than being implied by a recovery session.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  async function onSubmit(input: ResetPasswordInput) {
    const result = await resetPasswordAction(input, token);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Password updated — sign in with your new password.");
    router.push(result.data.redirectTo);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <FormField id="password" label="New password" error={errors.password?.message}>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          invalid={!!errors.password}
          {...register("password")}
        />
      </FormField>

      <FormField
        id="confirmPassword"
        label="Confirm new password"
        error={errors.confirmPassword?.message}
      >
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
      </FormField>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Updating…" : "Update password"}
        {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
