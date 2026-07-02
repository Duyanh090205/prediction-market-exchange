/**
 * Contract.lockedResult — the creator's committed settlement result, entered
 * and locked at creation for market integrity. Run against a live Postgres,
 * gated behind RUN_DB_ITEST=1 (offline `npm test` skips it).
 *
 * Verifies the two security-critical properties:
 *  1. VISIBILITY — the app's shared Prisma client (lib/prisma.ts) globally
 *     omits lockedResult, so no query returns it unless a route explicitly
 *     opts back in with `omit: { lockedResult: false }`.
 *  2. PERSISTENCE — the value written at creation is exactly what the
 *     opt-in read returns (what settlement enforces against).
 */

import { prisma as appPrisma } from "@/lib/prisma";

const RUN = process.env.RUN_DB_ITEST === "1";
const d = RUN ? describe : describe.skip;

d("Contract.lockedResult visibility (real Postgres, app client)", () => {
  const TITLE = `LOCKED ${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
  let contractId = 0;

  beforeAll(async () => {
    const c = await appPrisma.contract.create({
      data: {
        title: TITLE,
        description: "locked-result itest",
        status: "OPEN",
        minPrice: 0,
        maxPrice: 100,
        lockedResult: 42,
      },
    });
    contractId = c.id;
  });

  afterAll(async () => {
    await appPrisma.contract.deleteMany({ where: { title: TITLE } });
    await appPrisma.$disconnect();
  });

  test("create() result does NOT carry lockedResult (global omit)", async () => {
    const c = await appPrisma.contract.create({
      data: {
        title: TITLE,
        description: "second row, deleted in afterAll",
        status: "OPEN",
        minPrice: 0,
        maxPrice: 100,
        lockedResult: 7,
      },
    });
    expect("lockedResult" in c).toBe(false);
  });

  test("findUnique/findMany do NOT return lockedResult by default", async () => {
    const one = await appPrisma.contract.findUnique({ where: { id: contractId } });
    expect(one).not.toBeNull();
    expect("lockedResult" in one!).toBe(false);

    const many = await appPrisma.contract.findMany({ where: { title: TITLE } });
    expect(many.length).toBeGreaterThan(0);
    for (const c of many) expect("lockedResult" in c).toBe(false);
  });

  test("include-style queries (as used by market routes) do not leak it", async () => {
    const c = await appPrisma.contract.findUnique({
      where: { id: contractId },
      include: { quotes: true, trades: true },
    });
    expect(c).not.toBeNull();
    expect("lockedResult" in c!).toBe(false);
  });

  test("explicit opt-in returns the exact committed value (settle path)", async () => {
    const c = await appPrisma.contract.findUnique({
      where: { id: contractId },
      omit: { lockedResult: false },
    });
    expect(c?.lockedResult).toBe(42);
  });
});
