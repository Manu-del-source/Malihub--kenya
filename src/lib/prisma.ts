import { PrismaClient } from "@prisma/client";

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
