import type { Metadata } from "next";
import { MaliBot } from "@/components/messaging/mali-bot";

export const metadata: Metadata = { title: "MaliBot" };

export default function AssistantPage() {
  return <MaliBot />;
}
