/** MaliHub customer support contact (WhatsApp). Digits only, with country code. */
export const SUPPORT_WHATSAPP_NUMBER = "254726090372";
export const SUPPORT_WHATSAPP_DISPLAY = "+254 726 090 372";

export function supportWhatsAppUrl(message = "Hello MaliHub support, I need help."): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
