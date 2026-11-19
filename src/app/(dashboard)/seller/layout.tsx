import type { ReactNode } from "react";
import { SellerBrowserGate } from "@/components/pwa/seller-browser-gate";

/**
 * Keep the full Seller Centre browser-first while allowing product workflows
 * through SellerBrowserGate in the installed MaliHub app.
 */
export default function SellerLayout({ children }: { children: ReactNode }) {
  return <SellerBrowserGate>{children}</SellerBrowserGate>;
}
