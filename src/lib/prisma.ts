import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Next.js hot-reloads modules in dev, which would otherwise create a new
 * PrismaClient (and a new connection pool) on every save. Caching the
 * instance on `globalThis` in development avoids exhausting Postgres
 * connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Run a single operation with transaction-local PostgreSQL RLS context.
 *
 * The caller must first resolve the verified provider session to the internal
 * MaliHub users.id. Never pass a user id received from a client. All protected
 * queries in `work` MUST use the supplied `tx` client; global `prisma`
 * queries run outside this transaction and do not inherit its context.
 *
 * This helper does not enable RLS or replace application authorization checks.
 */
export async function withRlsUserContext<T>(
  userId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("A resolved MaliHub user id is required for RLS context");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return work(tx);
  });
}
