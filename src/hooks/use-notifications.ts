"use client";

import { useQuery } from "@tanstack/react-query";
import type { Notification } from "@/types";

type NotificationsResponse = {
  success: true;
  data: { notifications: Notification[]; unreadCount: number };
};

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error("Failed to load notifications");
      const json = (await res.json()) as NotificationsResponse;
      return json.data;
    },
    enabled,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
}
