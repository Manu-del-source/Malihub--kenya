import type { ReactNode } from "react";
import { SellerBrowserGate } from "@/components/pwa/seller-browser-gate";

export default function SellerCentreLayout({ children }: { children: ReactNode }) {
  return <SellerBrowserGate>{children}</SellerBrowserGate>;
}
