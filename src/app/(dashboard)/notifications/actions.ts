"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markNotificationRead, markAllNotificationsRead } from "@/services/notification-service";
import type { ApiResult } from "@/types";

export async function markNotificationReadAction(notificationId: string): Promise<ApiResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in required." };

  await markNotificationRead(user.id, notificationId);
  revalidatePath("/dashboard/notifications");
  return { success: true, data: null };
}

export async function markAllNotificationsReadAction(): Promise<ApiResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in required." };

  await markAllNotificationsRead(user.id);
  revalidatePath("/dashboard/notifications");
  return { success: true, data: null };
}
