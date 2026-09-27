import { z } from "zod";
import { KENYA_COUNTIES } from "@/lib/constants";

/**
 * Kenyan phone numbers, accepted in any of the common local formats
 * (0712345678, +254712345678, 254712345678, 0112345678 for Safaricom/
 * Airtel/Telkom ranges) — normalized to 2547XXXXXXXX / 2541XXXXXXXX by
 * toKenyanMsisdn() at the point of use, not here (this schema just
 * validates shape).
 */
const kenyanPhoneRegex = /^(?:\+?254|0)(7|1)\d{8}$/;

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[a-z]/, "Include at least one lowercase letter")
  .regex(/[0-9]/, "Include at least one number");

export const registerSchema = z
  .object({
    email: z.string().email("Enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z.string(),
    agreeToTerms: z.literal(true, {
      errorMap: () => ({ message: "You must agree to the terms to continue" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Numeric email-verification code.
 *
 * MaliHub's primary verification path is the emailed LINK, which matches the
 * flow users already had. Verification links require a custom email provider to
 * be configured on the Neon branch, though — with the shared provider only
 * CODES are available — so /verify-email also offers this fallback and
 * `resendVerificationAction` tells the form which of the two the service
 * actually accepted.
 *
 * The range is deliberately permissive (6–8 digits): the code length is a
 * setting of the auth service, not of MaliHub, and rejecting a valid code
 * because we guessed its width would lock somebody out of their own account.
 */
export const verifyEmailCodeSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, "Enter the 6-digit code from your email"),
});

export type VerifyEmailCodeInput = z.infer<typeof verifyEmailCodeSchema>;

export const accountIntentSchema = z.enum(["BUYER", "SELLER", "BOTH"]);

export const completeProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(80),
  phone: z
    .string()
    .trim()
    .regex(kenyanPhoneRegex, "Enter a valid Kenyan phone number, e.g. 0712345678"),
  county: z.enum(KENYA_COUNTIES, {
    errorMap: () => ({ message: "Select your county" }),
  }),
  accountIntent: accountIntentSchema,
  avatarUrl: z.string().url().optional().or(z.literal("")),
});

export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
