/**
 * Production database migrations must never run as a side effect of a Vercel
 * build. Vercel may retry builds, and the build role should not need permission
 * to modify Prisma's migration ledger.
 *
 * Apply reviewed migrations as a separate, explicitly approved maintenance
 * operation with the direct database URL and a role authorized to manage
 * migrations. The ordinary build path intentionally exits successfully here.
 */
console.log(
  "[migrations] Skipping production migrations during build. " +
    "Apply reviewed migrations separately with the approved maintenance procedure."
);
process.exit(0);
