/**
 * Per-side inventory (#4) — REAL Postgres integration test.
 *
 * Unlike matching.test.ts (which mocks the TransactionClient), this exercises
 * the actual engine raw SQL ("bidSize"/"askSize" columns, FOR UPDATE) against a
 * live database, end to end.
 *
 * Gated behind RUN_DB_ITEST=1 so the normal offline `npm test` never touches a
 * DB. Run with:
 *   $env:RUN_DB_ITEST="1"; $env:TRADING_DATABASE_URL="..."; npx jest perside.integration --runInBand
 */

import { PrismaClient } from "@prisma/client";
import { executeLimitOrder, executeMarketOrder } from "@/lib/matching-engine";

const RUN = process.env.RUN_DB_ITEST === "1";
const d = RUN ? describe : describe.skip;
// Only construct the client when actually running against a DB, so the normal
// offline `npm test` (which has no TRADING_DATABASE_URL) doesn't fail at import.
const prisma = RUN ? new PrismaClient() : (null as unknown as PrismaClient);

d("per-side inventory — real Postgres (#4)", () => {
  let contractId = 0;
  let makerId = 0;
  let takerId = 0;

  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const maker = await prisma.user.create({
      data: {
        username: `it_maker_${suffix}`,
        email: `it_maker_${suffix}@test.local`,
        hashedPassword: "x",
        role: "USER",
        status: "ACTIVE",
        balance: 1_000_000,
      },
    });
    const taker = await prisma.user.create({
      data: {
        username: `it_taker_${suffix}`,
        email: `it_taker_${suffix}@test.local`,
        hashedPassword: "x",
        role: "USER",
        status: "ACTIVE",
        balance: 1_000_000,
      },
    });
    const contract = await prisma.contract.create({
      data: {
        title: `IT ${suffix}`,
        description: "integration test",
        status: "OPEN",
        minPrice: 0,
        maxPrice: 100,
      },
    });
    makerId = maker.id;
    takerId = taker.id;
    contractId = contract.id;
  });

  afterAll(async () => {
    // Pattern-based cleanup — covers every contract/user this suite created.
    const contracts = await prisma.contract.findMany({
      where: { title: { startsWith: "IT " } },
      select: { id: true },
    });
    const ids = contracts.map((c) => c.id);
    if (ids.length) {
      await prisma.trade.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.quote.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.notification.deleteMany({ where: { userId: { in: [makerId, takerId] } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: "it_" } } });
    await prisma.$disconnect();
  });

  test("LIMIT OVER consumes ask inventory only; bid stays intact; quote OPEN", async () => {
    const q = await prisma.quote.create({
      data: { contractId, makerId, bid: 30, ask: 40, bidSize: 25, askSize: 10, status: "OPEN" },
    });

    const result = await prisma.$transaction((tx) =>
      executeLimitOrder(tx, takerId, {
        contractId,
        side: "OVER",
        size: 10,
        type: "LIMIT",
        quoteId: q.id,
      })
    );

    expect(result.totalFilled).toBe(10);

    const after = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(after?.askSize).toBe(0); // ask fully consumed
    expect(after?.bidSize).toBe(25); // bid untouched
    expect(after?.status).toBe("OPEN"); // still live on the bid side
  });

  test("MARKET UNDER sweeps the best bid only; that quote's ask stays intact", async () => {
    const q = await prisma.quote.create({
      data: { contractId, makerId, bid: 35, ask: 45, bidSize: 20, askSize: 8, status: "OPEN" },
    });

    const result = await prisma.$transaction((tx) =>
      executeMarketOrder(tx, takerId, {
        contractId,
        side: "UNDER",
        size: 12,
        type: "MARKET",
        limitPrice: 0, // accept any bid down to the band floor
      })
    );

    expect(result.totalFilled).toBe(12);

    const after = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(after?.bidSize).toBe(8); // 20 - 12
    expect(after?.askSize).toBe(8); // ask untouched
    expect(after?.status).toBe("OPEN");
  });

  test("#3 market order (no slippage cap) fills best price first across the book", async () => {
    // Dedicated contract so leftover quotes from earlier tests don't interfere.
    const c2 = await prisma.contract.create({
      data: { title: `IT SWEEP ${Date.now().toString(36)}`, description: "x", status: "OPEN", minPrice: 0, maxPrice: 100 },
    });
    // Two ask levels from the maker: 40 (better) and 45 (worse).
    await prisma.quote.create({
      data: { contractId: c2.id, makerId, ask: 45, askSize: 10, status: "OPEN" },
    });
    await prisma.quote.create({
      data: { contractId: c2.id, makerId, ask: 40, askSize: 10, status: "OPEN" },
    });

    // "Market Order" mode = limitPrice auto-set to the band edge (maxPrice for OVER).
    const result = await prisma.$transaction((tx) =>
      executeMarketOrder(tx, takerId, {
        contractId: c2.id,
        side: "OVER",
        size: 15,
        type: "MARKET",
        limitPrice: 100, // band edge → no real slippage cap
      })
    );

    expect(result.totalFilled).toBe(15);
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0].strike).toBe(40); // best price consumed first
    expect(result.fills[1].strike).toBe(45); // then the next level
  });

  test("#1 a user-created contract records its creator (FK + relation)", async () => {
    const suffix = Date.now().toString(36);
    const creator = await prisma.user.create({
      data: {
        username: `it_creator_${suffix}`,
        email: `it_creator_${suffix}@test.local`,
        hashedPassword: "x",
        role: "USER",
        status: "ACTIVE",
        balance: 1000,
      },
    });
    const c = await prisma.contract.create({
      data: {
        title: `IT CREATOR ${suffix}`,
        description: "x",
        status: "OPEN",
        minPrice: 0,
        maxPrice: 100,
        createdById: creator.id,
      },
      include: { creator: { select: { id: true, username: true } } },
    });

    expect(c.createdById).toBe(creator.id);
    expect(c.creator?.username).toBe(`it_creator_${suffix}`);
  });
});
