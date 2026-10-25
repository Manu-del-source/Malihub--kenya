/**
 * Shared API guards and safe errors for dropshipping endpoints.
 *
 * Authorization is re-checked on EVERY endpoint, including reads. A page-level
 * admin layout or a hidden button is presentation, never a permission.
 *
 * Error logging is deliberately code-only: Prisma error messages can contain
 * SQL fragments and values, and supplier contact/cost data must not reach logs.
 */

import { NextResponse } from "next/server";
import type { PrismaClient, UserRole } from "@prisma/client";
import { getCurrentUser, isAdministratorRole } from "@/lib/auth";

export type ApiActor = {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  isBanned: boolean;
};

export type GuardResult =
  | { ok: true; actor: ApiActor }
  | { ok: false; response: NextResponse };

function denied(error: string, status: number): GuardResult {
  return { ok: false, response: NextResponse.json({ success: false, error }, { status }) };
}

export function actorFromSession(
  user: { id: string; email: string; role: UserRole; isActive: boolean; isBanned: boolean } | null | undefined,
): ApiActor | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    isBanned: user.isBanned,
  };
}

export async function requireAdminActor(): Promise<GuardResult> {
  const actor = actorFromSession((await getCurrentUser())?.user);
  if (!actor) return denied("Sign in required.", 401);
  if (!isAdministratorRole(actor.role) || !actor.isActive || actor.isBanned) {
    return denied("Administrator access is required.", 403);
  }
  return { ok: true, actor };
}

export async function requireActiveActor(): Promise<GuardResult> {
  const actor = actorFromSession((await getCurrentUser())?.user);
  if (!actor) return denied("Sign in required.", 401);
  if (!actor.isActive || actor.isBanned) return denied("Account access denied.", 403);
  return { ok: true, actor };
}

export async function requireVerifiedSeller(
  db: Pick<PrismaClient, "seller">,
  actor: ApiActor,
): Promise<{ id: string; verificationStatus: string } | NextResponse> {
  const seller = await db.seller.findUnique({
    where: { userId: actor.id },
    select: { id: true, verificationStatus: true },
  });
  if (!seller) {
    return NextResponse.json({ success: false, error: "Seller setup required." }, { status: 403 });
  }
  if (seller.verificationStatus !== "VERIFIED") {
    return NextResponse.json(
      { success: false, error: "Seller verification is required before importing supplier products." },
      { status: 403 },
    );
  }
  return { id: seller.id, verificationStatus: seller.verificationStatus };
}

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** Logs only a Prisma error code. Never logs the error object or request body. */
export function logSafeError(label: string, error: unknown): void {
  const code = isPrismaErrorCode(error, "P2002")
    ? "P2002"
    : isPrismaErrorCode(error, "P2025")
      ? "P2025"
      : isPrismaErrorCode(error, "P2003")
        ? "P2003"
        : "unexpected";
  console.error(label, { code });
}

export function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json(
    { success: false, error, ...(code ? { code } : {}) },
    { status },
  );
}
