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
