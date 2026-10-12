/**
 * Browser-side bridge to Paystack InlineJS (`https://js.paystack.co/v2/inline.js`).
 *
 * The script is loaded with `<Script strategy="afterInteractive">` by the
 * screens that collect payments. Everything money-related stays server-side:
 * this module only opens Paystack's OWN hosted checkout with an access code
 * the server issued, and forwards the popup's outcome to callers. The popup
 * callbacks are UI hints — `onSuccess` means "the buyer closed the popup
 * after Paystack said success", and the caller must then ask the server to
 * verify the transaction before treating anything as paid.
 */

export type PaystackPopupCallbacks = {
  onSuccess: (transaction: { reference: string }) => void;
  onCancel: () => void;
  onError: (error: { message: string }) => void;
};

export type PaystackPopup = {
  resumeTransaction: (accessCode: string, callbacks?: PaystackPopupCallbacks) => unknown;
};

declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopup;
  }
}

/**
 * Opens the Paystack hosted checkout for a server-issued access code.
 * Returns false when the InlineJS library is not loaded yet — callers should
 * tell the buyer to wait and retry rather than failing the order.
 */
export function resumePaystackTransaction(
  accessCode: string,
  callbacks: PaystackPopupCallbacks
): boolean {
  if (typeof window === "undefined" || !window.PaystackPop) return false;
  try {
    const popup = new window.PaystackPop();
    popup.resumeTransaction(accessCode, callbacks);
    return true;
  } catch {
    return false;
  }
}
