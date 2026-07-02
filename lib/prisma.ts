import { PrismaClient } from "@prisma/client";

// Contract.lockedResult is the creator's private committed settlement result.
// Omit it from every query by default so no route can leak it to other
// players; the few creator-facing paths opt back in with
// `omit: { lockedResult: false }` or an explicit `select`.
const createPrismaClient = () =>
  new PrismaClient({
    omit: { contract: { lockedResult: true } },
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
