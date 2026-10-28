"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdministratorAction } from "@/lib/auth";
import { campaignDateRange, campaignFormSchema, campaignUpdateFormSchema } from "@/lib/validations/campaign";
import { uuidSchema } from "@/lib/validations/admin";
import { logServerError } from "@/lib/safe-log";
import {
  CampaignServiceError,
  createCampaign,
  deleteCampaign,
  updateCampaign,
} from "@/services/campaign-service";

function rawCampaignForm(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    status: String(formData.get("status") ?? "DRAFT"),
    productIds: formData.getAll("productIds").filter((value): value is string => typeof value === "string"),
  };
}

function errorCode(error: unknown): string {
  if (error instanceof CampaignServiceError) {
    return error.message.toLowerCase().includes("slug") ? "slug" : "invalid";
  }
  logServerError("[admin/campaigns] Campaign mutation failed", error);
  return "save";
}

function revalidateCampaignSurfaces() {
  revalidatePath("/admin/campaigns");
  revalidatePath("/admin/campaigns/[id]", "page");
  revalidatePath("/campaigns");
  revalidatePath("/campaigns/[slug]", "page");
}

export async function createCampaignAction(formData: FormData): Promise<void> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) redirect("/admin/campaigns?error=unauthorized");

  const parsed = campaignFormSchema.safeParse(rawCampaignForm(formData));
  if (!parsed.success) redirect("/admin/campaigns?error=invalid");

  const dates = campaignDateRange(parsed.data.startDate, parsed.data.endDate);
  try {
    await createCampaign(
      {
        title: parsed.data.title,
        slug: parsed.data.slug,
        description: parsed.data.description,
        ...dates,
        status: parsed.data.status,
        productIds: parsed.data.productIds,
      },
      { id: auth.user.id, email: auth.user.email },
    );
  } catch (error) {
    redirect(`/admin/campaigns?error=${errorCode(error)}`);
  }

  revalidateCampaignSurfaces();
  redirect("/admin/campaigns?notice=created");
}

export async function updateCampaignAction(formData: FormData): Promise<void> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) redirect("/admin/campaigns?error=unauthorized");

  const parsed = campaignUpdateFormSchema.safeParse({
    ...rawCampaignForm(formData),
    id: String(formData.get("id") ?? ""),
  });
  if (!parsed.success) redirect("/admin/campaigns?error=invalid");

  const dates = campaignDateRange(parsed.data.startDate, parsed.data.endDate);
  try {
    await updateCampaign(
      parsed.data.id,
      {
        title: parsed.data.title,
        slug: parsed.data.slug,
        description: parsed.data.description,
        ...dates,
        status: parsed.data.status,
        productIds: parsed.data.productIds,
      },
      { id: auth.user.id, email: auth.user.email },
    );
  } catch (error) {
    redirect(`/admin/campaigns/${parsed.data.id}?error=${errorCode(error)}`);
  }

  revalidateCampaignSurfaces();
  redirect("/admin/campaigns?notice=updated");
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const auth = await requireAdministratorAction();
  if (!auth.ok) redirect("/admin/campaigns?error=unauthorized");

  const parsed = uuidSchema.safeParse(String(formData.get("id") ?? ""));
  if (!parsed.success) redirect("/admin/campaigns?error=invalid");

  try {
    await deleteCampaign(parsed.data, { id: auth.user.id, email: auth.user.email });
  } catch (error) {
    redirect(`/admin/campaigns?error=${errorCode(error)}`);
  }

  revalidateCampaignSurfaces();
  redirect("/admin/campaigns?notice=deleted");
}
