"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { signUpAction } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";

export function RegisterForm() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(input: RegisterInput) {
    const result = await signUpAction(input);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(result.data.email)}`);
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

      <FormField id="password" label="Password" error={errors.password?.message}>
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
        label="Confirm password"
        error={errors.confirmPassword?.message}
      >
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary-500"
            {...register("agreeToTerms")}
          />
          I agree to MaliHub&rsquo;s{" "}
          <Link href="/terms" className="text-primary-400 hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-primary-400 hover:underline">
            Privacy Policy
          </Link>
          .
        </label>
        {errors.agreeToTerms && (
          <p role="alert" className="text-xs text-destructive">
            {errors.agreeToTerms.message}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Creating account…" : "Create account"}
        {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
