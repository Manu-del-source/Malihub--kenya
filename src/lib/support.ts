/** MaliHub customer support contact (WhatsApp). Digits only, with country code. */
export const SUPPORT_WHATSAPP_NUMBER = "254726090372";
export const SUPPORT_WHATSAPP_DISPLAY = "+254 726 090 372";

/** Public support line (WhatsApp and calls), shown to logged-out visitors. Task wording asks to call it SUPPORT_WHATSAPP, so the constant is kept here as a display constant alongside the personal-number exports above. */
export const SUPPORT_WHATSAPP = "+254795787261";
/** Digits-only form of the public support line, used to build wa.me links. */
export const SUPPORT_WHATSAPP_NUMBER_PUBLIC = "254795787261";

export function supportWhatsAppUrl(message = "Hello MaliHub support, I need help."): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** Public WhatsApp link for the support line shown to all visitors. */
export function publicSupportWhatsAppUrl(message = "Hello MaliHub Kenya, I need help."): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER_PUBLIC}?text=${encodeURIComponent(message)}`;
}
