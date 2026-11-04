import "server-only";

/** Never log provider responses, database errors, request bodies, or secrets.
 * Keep only a small allowlist of diagnostic Prisma codes. */
export function logServerError(label: string, error: unknown): void {
  const value = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  const code = value === "P2002" || value === "P2003" || value === "P2025"
    ? value
    : "unexpected";
  console.error(label, { code });
}

type CloudinaryDiagnostic = {
  errorId: string;
  purpose: "product" | "message";
};

/** Log only bounded, redacted Cloudinary diagnostics; never dump SDK errors. */
export function logCloudinaryUploadError(error: unknown, context: CloudinaryDiagnostic): void {
  const value = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const nested = typeof value.error === "object" && value.error !== null
    ? value.error as Record<string, unknown>
    : {};
  const statusValue = value.http_code ?? value.statusCode ?? nested.http_code;
  const httpStatus = typeof statusValue === "number" && Number.isInteger(statusValue)
    && statusValue >= 100 && statusValue <= 599
    ? statusValue
    : undefined;
  const rawCode = value.code ?? nested.code;
  const providerCode = typeof rawCode === "string" && /^[a-z0-9_.-]{1,40}$/i.test(rawCode)
    ? rawCode
    : undefined;
  const rawName = value.name;
  const errorName = typeof rawName === "string" && /^[a-z0-9_.-]{1,60}$/i.test(rawName)
    ? rawName
    : "Error";
  const rawMessage = typeof value.message === "string"
    ? value.message
    : typeof nested.message === "string" ? nested.message : "";
  const message = rawMessage
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/data:[^\s]+/gi, "[data]")
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [redacted]")
    .replace(/(api[_-]?key|api[_-]?secret|token|password|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_+/=-]{80,}/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);

  console.error("[image-upload] Cloudinary upload failed", {
    errorId: context.errorId,
    purpose: context.purpose,
    errorName,
    ...(httpStatus ? { httpStatus } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(message ? { providerMessage: message } : {}),
  });
}
