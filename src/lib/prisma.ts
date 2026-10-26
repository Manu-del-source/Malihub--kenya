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
 * Run RLS-protected work with a trusted MaliHub user id in transaction-local
 * PostgreSQL context. The caller must resolve the provider identity first;
 * never pass a user id supplied by the client.
 *
 * All protected Prisma reads/writes for this operation must use the provided
 * transaction client. Queries made through the global `prisma` client do not
 * inherit this context.
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
