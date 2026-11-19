import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { publicSupportWhatsAppUrl } from "@/lib/support";

/** Persistent customer-support shortcut on public marketplace pages. */
export function FloatingWhatsAppButton() {
  return (
    <a
      href={publicSupportWhatsAppUrl()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with MaliHub on WhatsApp"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-50 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(0,0,0,0.22)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#1FBE5B] hover:shadow-[0_6px_20px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 sm:bottom-6 sm:right-6"
    >
      <WhatsAppIcon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
      <span>Chat on WhatsApp</span>
    </a>
  );
}
