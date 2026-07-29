"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { signInAction } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const oauthError = searchParams.get("error");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (oauthError) toast.error(oauthError);
  }, [oauthError]);

  async function onSubmit(input: LoginInput) {
    const result = await signInAction(input, redirectTo);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.push(result.data.redirectTo);
    router.refresh();
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
          autoComplete="current-password"
          placeholder="••••••••"
          invalid={!!errors.password}
          {...register("password")}
        />
      </FormField>

      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-xs text-primary-400 hover:underline">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Signing in…" : "Sign in"}
        {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
