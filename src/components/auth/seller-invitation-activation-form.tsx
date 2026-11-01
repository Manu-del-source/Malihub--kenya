"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { activateSellerInvitationAction } from "@/app/(auth)/seller-invitation-actions";
import { FormField } from "@/components/auth/form-field";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";

export function SellerInvitationActivationForm() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  useEffect(() => {
    // URL fragments are not sent in HTTP requests or referrer headers. Remove
    // the bearer token from the address bar immediately after reading it.
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const invitationToken = params.get("token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!invitationToken) {
      setLinkError("The invitation token is missing. Ask the MaliHub administrator for a fresh link.");
      return;
    }
    setToken(invitationToken);
  }, []);

  async function onSubmit(input: ResetPasswordInput) {
    if (!token) {
      setLinkError("The invitation token is missing. Ask the MaliHub administrator for a fresh link.");
      return;
    }
    const result = await activateSellerInvitationAction(input, token);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Password created. Check your email to verify your account.");
    router.push(result.data.redirectTo);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 flex flex-col gap-4">
      {linkError && <p role="alert" className="text-sm text-destructive">{linkError}</p>}
      <FormField id="password" label="Create password" error={errors.password?.message}>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          invalid={!!errors.password}
          {...register("password")}
        />
      </FormField>
      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder="Enter the password again"
          invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
      </FormField>
      <Button type="submit" size="lg" disabled={isSubmitting || !token} className="w-full">
        {isSubmitting ? "Creating account…" : !token ? "Loading invitation…" : "Create password"}
        {!isSubmitting && token && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
