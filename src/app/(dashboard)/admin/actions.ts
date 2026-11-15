"use server";

import { logServerError } from "@/lib/safe-log";

import { revalidatePath } from "next/cache";
import { requireAdministratorAction } from "@/lib/auth";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  adminListingDeleteSchema,
  listingModerationActionSchema,
  sellerReviewActionSchema,
  uuidSchema,
  adminSellerCreateSchema,
  adminSellerInvitationSchema,
} from "@/lib/validations/admin";
import {
  AdminServiceError,
  createAdminCategory,
  deleteAdminCategory,
  deleteAdminSeller,
  deleteAdminListing,
  moderateListing,
  setSellerVerificationStatus,
  updateAdminCategory,
  recordAdminOrderFulfilment,
} from "@/services/admin-service";
import {
  createAdminSellerAccount,
  resendAdminSellerInvitation,
  SellerOnboardingError,
} from "@/services/admin-seller-onboarding-service";
import type { ApiResult } from "@/types";

/**
 * Admin mutations — the ONLY write surface of the admin dashboard.
 *
 * ─── The shape every action follows, and why ───────────────────────────────
 * 1. `requireAdministratorAction()` FIRST. Every action below is
 *    independently reachable (a Server Action is a network endpoint; a page
 *    guard protecting the button's rendering protects nothing here). The role
 *    is re-read from MaliHub's own `users.role` row against the Neon Auth
 *    session on every call — a client-sent role, id, or "I am an admin" flag
 *    is never consulted, and there is no parameter through which one could
 *    be smuggled: the actor is only ever the session's own account.
 * 2. Zod-validate the input — target ids must be UUIDs, notes are capped.
 *    Anything that could move money or change identity simply isn't here:
 *    orders and payments have NO admin mutation at all (the existing order
 *    architecture defines no safe administrative transition — see
 *    `src/services/admin-service.ts`), and user records are read-only from
 *    `/admin`.
 * 3. The service re-reads the target row and validates the state transition,
 *    so a forged/stale id fails with "not found" rather than blindly
 *    updating, and audit + seller notification ride along with the write.
 * 4. Errors are mapped to `ApiResult` user copy; unexpected ones are logged
 *    server-side and reported generically.
 *
 * CSRF: these inherit Next.js's built-in Server Action origin check (the
 * same posture `src/lib/csrf.ts` documents for the whole actions surface),
 * so no second token mechanism is bolted on.
 */

type Actor = { id: string; email: string };

function toResult<T>(
  actor: Actor,
  run: (actor: Actor) => Promise<T>
): Promise<ApiResult<T>> {
  return run(actor)
    .then((data) => ({ success: true as const, data }))
    .catch((error) => {
      if (error instanceof AdminServiceError) {
        return { success: false as const, error: error.message };
      }
      logServerError("Admin action failed", error);
      return {
        success: false as const,
        error: "Something went wrong. Please try again.",
      };
    });
}

/** Revalidate the admin surfaces touched by a decision, plus the seller's
 * own dashboard where the consequence lands. */
function revalidateAdmin(...paths: string[]) {
  for (const path of ["/admin", ...paths]) revalidatePath(path);
}

// ─── Seller verification ───────────────────────────────────────────────────

export async function verifySellerAction(
  input: unknown
): Promise<ApiResult<{ businessName: string; verificationStatus: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = sellerReviewActionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid request." };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const result = await setSellerVerificationStatus({
      sellerId: parsed.data.sellerId,
      decision: "VERIFIED",
      note: parsed.data.note,
      actor,
    });
    revalidateAdmin("/admin/sellers");
    return result;
  });
}

export async function rejectSellerAction(
  input: unknown
): Promise<ApiResult<{ businessName: string; verificationStatus: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = sellerReviewActionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid request." };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const result = await setSellerVerificationStatus({
      sellerId: parsed.data.sellerId,
      decision: "REJECTED",
      note: parsed.data.note,
      actor,
    });
    revalidateAdmin("/admin/sellers");
    return result;
  });
}

export async function resetSellerVerificationAction(
  input: unknown
): Promise<ApiResult<{ businessName: string; verificationStatus: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = sellerReviewActionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid request." };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const result = await setSellerVerificationStatus({
      sellerId: parsed.data.sellerId,
      decision: "UNVERIFIED",
      note: parsed.data.note,
      actor,
    });
    revalidateAdmin("/admin/sellers");
    return result;
  });
}

// ─── Seller deletion ───────────────────────────────────────────────────────

export async function deleteAdminSellerAction(
  input: unknown
): Promise<ApiResult<{ id: string; businessName: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (auth.user.role !== "SUPER_ADMIN") {
    return { success: false, error: "Only a super admin can delete seller profiles." };
  }

  const parsed = uuidSchema.safeParse(
    (input as { sellerId?: unknown } | null)?.sellerId
  );
  if (!parsed.success) return { success: false, error: "Invalid seller." };

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const result = await deleteAdminSeller({ sellerId: parsed.data, actor });
    revalidateAdmin("/admin/sellers", "/admin/users");
    return result;
  });
}

// ─── Listing moderation ────────────────────────────────────────────────────

export async function moderateListingAction(
  input: unknown
): Promise<ApiResult<{ id: string; title: string; status: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = listingModerationActionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid request." };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const result = await moderateListing({
      productId: parsed.data.productId,
      action: parsed.data.action,
      note: parsed.data.note,
      actor,
    });
    // A moderation decision changes public visibility, so the public
    // surfaces revalidate alongside the admin ones.
    revalidateAdmin("/admin/listings", `/products/${result.slug}`);
    revalidatePath("/marketplace");
    revalidatePath("/search");
    revalidatePath("/seller/listings");
    return { id: result.id, title: result.title, status: result.status };
  });
}

// ─── Categories ────────────────────────────────────────────────────────────

/** Remove a listing from the marketplace. Only SUPER_ADMIN may invoke this. */
export async function deleteAdminListingAction(
  input: unknown
): Promise<ApiResult<{ id: string; title: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (auth.user.role !== "SUPER_ADMIN") {
    return { success: false, error: "Only a super admin can delete listings." };
  }

  const parsed = adminListingDeleteSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request." };

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const result = await deleteAdminListing({ productId: parsed.data.productId, actor });
    revalidateAdmin("/admin/listings", `/admin/listings/${result.id}`, `/products/${result.slug}`);
    revalidatePath("/marketplace");
    revalidatePath("/search");
    revalidatePath("/seller/listings");
    return { id: result.id, title: result.title };
  });
}

export async function createCategoryAction(
  input: unknown
): Promise<ApiResult<{ id: string; name: string; slug: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = categoryCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const category = await createAdminCategory({ ...parsed.data, actor });
    revalidateAdmin("/admin/categories");
    revalidatePath("/categories");
    revalidatePath("/marketplace");
    return { id: category.id, name: category.name, slug: category.slug };
  });
}

export async function updateCategoryAction(
  input: unknown
): Promise<ApiResult<{ id: string; name: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = categoryUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    const category = await updateAdminCategory({ ...parsed.data, actor });
    revalidateAdmin("/admin/categories");
    revalidatePath("/categories");
    revalidatePath("/marketplace");
    return { id: category.id, name: category.name };
  });
}

export async function deleteCategoryAction(
  input: unknown
): Promise<ApiResult<{ id: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = uuidSchema.safeParse(
    (input as { id?: unknown } | null)?.id
  );
  // Deleting only needs the id — the same UUID rule the update schema uses.
  if (!parsed.success) {
    return { success: false, error: "Invalid request." };
  }

  return toResult({ id: auth.user.id, email: auth.user.email }, async (actor) => {
    await deleteAdminCategory({ id: parsed.data, actor });
    revalidateAdmin("/admin/categories");
    revalidatePath("/categories");
    revalidatePath("/marketplace");
    return { id: parsed.data };
  });
}


// ─── Manual seller onboarding ──────────────────────────────────────────────

export async function createAdminSellerAction(
  input: unknown
): Promise<ApiResult<{
  sellerId: string;
  businessName: string;
  email: string;
  activationUrl: string;
  expiresAt: string;
}>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = adminSellerCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Check the seller details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const created = await createAdminSellerAccount(parsed.data, {
      id: auth.user.id,
      email: auth.user.email,
    });
    revalidatePath("/admin/sellers");
    revalidatePath("/admin/users");
    return {
      success: true,
      data: {
        sellerId: created.sellerId,
        businessName: created.businessName,
        email: created.email,
        activationUrl: created.activationUrl,
        expiresAt: created.expiresAt,
      },
    };
  } catch (error) {
    if (error instanceof SellerOnboardingError) {
      return { success: false, error: error.message };
    }
    logServerError("Admin seller onboarding failed", error);
    return { success: false, error: "Could not create the seller account. Please try again." };
  }
}

export async function resendAdminSellerInvitationAction(
  input: unknown
): Promise<ApiResult<{ email: string; method: "invitation" | "verification-link" | "code"; activationUrl?: string; expiresAt?: string }>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = adminSellerInvitationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Enter a valid seller email address." };

  try {
    const result = await resendAdminSellerInvitation(parsed.data.email);
    return {
      success: true,
      data: { email: parsed.data.email, ...result },
    };
  } catch (error) {
    if (error instanceof SellerOnboardingError) {
      return { success: false, error: error.message };
    }
    logServerError("Admin seller invitation resend failed", error);
    return { success: false, error: "Could not resend the setup email. Please try again." };
  }
}


// ─── Order fulfilment oversight ────────────────────────────────────────────

export async function recordAdminOrderFulfilmentAction(input: unknown): Promise<ApiResult<{
  orderNumber: string;
  status: "SHIPPED" | "DELIVERED";
  changed: boolean;
}>> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input || typeof input !== "object") return { success: false, error: "Invalid order update." };
  const value = input as Record<string, unknown>;
  const uuid = typeof value.orderId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.orderId);
  const step = value.step;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!uuid || (step !== "SHIPPED" && step !== "DELIVERED") || reason.length < 10 || reason.length > 500) {
    return { success: false, error: "Provide a valid order, fulfilment status and reason (10–500 characters)." };
  }

  let shipment: { carrierName: string; trackingNumber: string; trackingUrl?: string | null } | undefined;
  if (step === "SHIPPED") {
    const raw = value.shipment;
    if (!raw || typeof raw !== "object") return { success: false, error: "Courier and tracking details are required." };
    const data = raw as Record<string, unknown>;
    if (typeof data.carrierName !== "string" || typeof data.trackingNumber !== "string" ||
      (data.trackingUrl !== undefined && typeof data.trackingUrl !== "string")) {
      return { success: false, error: "Enter valid courier and tracking details." };
    }
    shipment = {
      carrierName: data.carrierName,
      trackingNumber: data.trackingNumber,
      ...(typeof data.trackingUrl === "string" ? { trackingUrl: data.trackingUrl } : {}),
    };
  }

  try {
    const result = await recordAdminOrderFulfilment(
      { orderId: value.orderId as string, step, reason, ...(shipment ? { shipment } : {}) },
      { id: auth.user.id, email: auth.user.email }
    );
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${value.orderId}`);
    revalidatePath("/seller/orders");
    revalidatePath("/buyer/orders");
    return { success: true, data: { orderNumber: result.orderNumber, status: result.status, changed: result.changed } };
  } catch (error) {
    if (error instanceof AdminServiceError) return { success: false, error: error.message };
    logServerError("Admin order fulfilment update failed", error);
    return { success: false, error: "Could not update this order. Please refresh and try again." };
  }
}
