import { NextResponse } from "next/server";
import { SupplierFulfilmentError } from "@/services/dropshipping-fulfilment-service";
import { SupplierPurchaseError } from "@/services/dropshipping-purchase-service";
import { SupplierReturnError } from "@/services/dropshipping-return-service";
import { logSafeError } from "@/lib/dropshipping/http";

type DomainError = { message: string; code: string; status: number };

function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof SupplierFulfilmentError ||
    error instanceof SupplierPurchaseError ||
    error instanceof SupplierReturnError
  );
}

/** Maps domain errors to safe JSON; logs only an error code, never a message. */
export function dropshippingErrorResponse(error: unknown, label: string): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  logSafeError(label, error);
  return NextResponse.json(
    { success: false, error: "Unable to complete this dropshipping operation." },
    { status: 500 },
  );
}
