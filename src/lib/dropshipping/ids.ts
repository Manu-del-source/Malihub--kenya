/**
 * Deterministic references and idempotency keys.
 *
 * Every key is derived from a database id the caller cannot choose. A retried
 * webhook, a double-clicked form or a concurrent worker therefore converges on
 * the same unique row instead of creating a second supplier order, purchase or
 * refund instruction.
 */

export function supplierFulfilmentReference(orderNumber: string, sequence: number): string {
  const safe = orderNumber.replace(/[^A-Z0-9-]/gi, "").slice(0, 24);
  return `SF-${safe}-${String(sequence).padStart(2, "0")}`;
}

export function supplierFulfilmentIdempotencyKey(orderItemId: string): string {
  return `supplier-fulfilment:order-item:${orderItemId}`;
}

export function supplierPurchaseIdempotencyKey(fulfilmentId: string): string {
  return `supplier-purchase:fulfilment:${fulfilmentId}`;
}

export function supplierPurchaseReference(fulfilmentReference: string): string {
  return `SP-${fulfilmentReference.replace(/^SF-/, "")}`;
}

export function supplierReturnIdempotencyKey(fulfilmentId: string): string {
  return `supplier-return:fulfilment:${fulfilmentId}`;
}

export function supplierReturnRefundIdempotencyKey(returnRequestId: string): string {
  return `supplier-return-refund:${returnRequestId}`;
}

export function supplierFulfilmentEventIdempotencyKey(
  fulfilmentId: string,
  toStatus: string,
  action: string,
): string {
  return `supplier-fulfilment-event:${fulfilmentId}:${action}:${toStatus}`;
}
