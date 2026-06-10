/**
 * deep-audit-bug — empirical proof tests for this session's changes, run against
 * a live Postgres. Gated behind RUN_DB_ITEST=1 (offline `npm test` skips it).
 *
 * Each test targets a specific suspected bug class:
 *  - Pass 1/6 wiring: legacy `size` body still maps to both sides (quoteService)
 *  - Pass 2/5 math+state: two-sided hits never over-commit maker margin
 *  - Pass 5 state: a quote EXHAUSTS only when BOTH sides are depleted
 *  - Pass 6 data: one-sided quotes (bid-only) reject the unoffered side
 *  - Pass 1 wiring: self-trade prevention still holds with per-side sizing
 */

import { PrismaClient } from "@prisma/client";
import {
  executeLimitOrder,
  executeMarketOrder,
  SelfTradeError,
  SideNotOfferedError,
} from "@/lib/matching-engine";
import { calculateAvailableMargin } from "@/lib/margin";
import { postQuote } from "@/lib/quoteService";

const RUN = process.env.RUN_DB_ITEST === "1";
const d = RUN ? describe : describe.skip;
const prisma = RUN ? new PrismaClient() : (null as unknown as PrismaClient);

d("deep-audit — per-side + creator changes (real Postgres)", () => {
  let maker = 0;
  let taker = 0;
  let taker2 = 0;

  async function mkUser(tag: string, balance: number) {
    const u = await prisma.user.create({
      data: {
        username: `audit_${tag}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`,
        email: `audit_${tag}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}@test.local`,
        hashedPassword: "x",
        role: "USER",
        status: "ACTIVE",
        balance,
      },
    });
    return u.id;
  }

  async function mkContract() {
    const c = await prisma.contract.create({
      data: { title: `AUDIT ${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`, description: "x", status: "OPEN", minPrice: 0, maxPrice: 100 },
    });
    return c.id;
  }

  beforeAll(async () => {
    maker = await mkUser("maker", 1_000_000);
    taker = await mkUser("taker", 1_000_000);
    taker2 = await mkUser("taker2", 1_000_000);
  });

  afterAll(async () => {
    const contracts = await prisma.contract.findMany({ where: { title: { startsWith: "AUDIT " } }, select: { id: true } });
    const ids = contracts.map((c) => c.id);
    if (ids.length) {
      await prisma.trade.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.quote.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.pricePoint.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.notification.deleteMany({ where: { user: { username: { startsWith: "audit_" } } } });
    await prisma.balanceLedger.deleteMany({ where: { user: { username: { startsWith: "audit_" } } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: "audit_" } } });
    await prisma.$disconnect();
  });

  // ── Pass 1/6: legacy `size` body still maps to both sides ──────────────────
  test("quoteService: legacy {bid,ask,size} maps size to BOTH bidSize and askSize", async () => {
    const contractId = await mkContract();
    const res = await postQuote({
      actorId: maker,
      userRole: "USER",
      body: { contractId, bid: 30, ask: 40, size: 17 }, // legacy single size
    });
    expect(res.status).toBe(201);
    const q = await prisma.quote.findFirst({ where: { contractId, makerId: maker }, orderBy: { id: "desc" } });
    expect(q?.bidSize).toBe(17);
    expect(q?.askSize).toBe(17);
  });

  test("quoteService: legacy one-sided {bid,size} sets only bidSize", async () => {
    const contractId = await mkContract();
    const res = await postQuote({
      actorId: maker,
      userRole: "USER",
      body: { contractId, bid: 25, size: 12 }, // ask omitted
    });
    expect(res.status).toBe(201);
    const q = await prisma.quote.findFirst({ where: { contractId, makerId: maker }, orderBy: { id: "desc" } });
    expect(q?.bidSize).toBe(12);
    expect(q?.askSize).toBeNull();
    expect(q?.ask).toBeNull();
  });

  // ── Pass 2/5: a maker hit on one side can still be hit on the HEDGING side ──
  // After #4 enables two-sided quotes, a maker routinely gets hit on both bid and
  // ask of the SAME quote. The second (hedging) fill must succeed — combined
  // worst-case is 0, so it adds no risk. If the engine refuses it, that's a bug.
  test("margin: maker can be hit on the hedging side without a false toxic-cancel", async () => {
    const contractId = await mkContract();
    const m = await mkUser("hedge", 25);
    const q = await prisma.quote.create({
      data: { contractId, makerId: m, bid: 30, ask: 40, bidSize: 25, askSize: 25, status: "OPEN" },
    });

    // Taker buys OVER 25 → maker becomes UNDER@40 ×25 (uses all its margin).
    const r1 = await prisma.$transaction((tx) =>
      executeLimitOrder(tx, taker, { contractId, side: "OVER", size: 25, type: "LIMIT", quoteId: q.id })
    );
    expect(r1.totalFilled).toBe(25);
    expect(await calculateAvailableMargin(m)).toBe(0);

    // Taker2 sells UNDER 25 → maker becomes OVER@30 ×25, which HEDGES UNDER@40.
    // Combined worst-case is 0 → the maker can safely take it; fill must succeed.
    let r2filled = 0;
    let r2err: unknown = null;
    try {
      const r2 = await prisma.$transaction((tx) =>
        executeLimitOrder(tx, taker2, { contractId, side: "UNDER", size: 25, type: "LIMIT", quoteId: q.id })
      );
      r2filled = r2.totalFilled;
    } catch (e) {
      r2err = e;
    }

    expect(r2err).toBeNull(); // bug → throws MakerMarginError and cancels the quote
    expect(r2filled).toBe(25);
    expect(await calculateAvailableMargin(m)).toBeGreaterThanOrEqual(0);
  });

  // ── Pass 5: a quote EXHAUSTS only when BOTH sides are depleted ──────────────
  test("state: quote stays OPEN after one side empties, EXHAUSTED only when both do", async () => {
    const contractId = await mkContract();
    const q = await prisma.quote.create({
      data: { contractId, makerId: maker, bid: 30, ask: 40, bidSize: 5, askSize: 5, status: "OPEN" },
    });

    await prisma.$transaction((tx) =>
      executeLimitOrder(tx, taker, { contractId, side: "OVER", size: 5, type: "LIMIT", quoteId: q.id })
    );
    const mid = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(mid?.askSize).toBe(0);
    expect(mid?.bidSize).toBe(5);
    expect(mid?.status).toBe("OPEN"); // bid side still live

    await prisma.$transaction((tx) =>
      executeLimitOrder(tx, taker, { contractId, side: "UNDER", size: 5, type: "LIMIT", quoteId: q.id })
    );
    const done = await prisma.quote.findUnique({ where: { id: q.id } });
    expect(done?.bidSize).toBe(0);
    expect(done?.status).toBe("EXHAUSTED"); // both sides depleted
  });

  // ── Pass 6: one-sided (bid-only) quote rejects the unoffered side ───────────
  test("data: bid-only quote — LIMIT OVER throws, MARKET OVER fills nothing", async () => {
    const contractId = await mkContract();
    const q = await prisma.quote.create({
      data: { contractId, makerId: maker, bid: 30, ask: null, bidSize: 10, askSize: null, status: "OPEN" },
    });

    await expect(
      prisma.$transaction((tx) =>
        executeLimitOrder(tx, taker, { contractId, side: "OVER", size: 5, type: "LIMIT", quoteId: q.id })
      )
    ).rejects.toThrow(SideNotOfferedError);

    const mkt = await prisma.$transaction((tx) =>
      executeMarketOrder(tx, taker, { contractId, side: "OVER", size: 5, type: "MARKET", limitPrice: 100 })
    );
    expect(mkt.totalFilled).toBe(0); // no ask inventory anywhere in the book
  });

  // ── Pass 1: self-trade prevention still holds with per-side sizing ──────────
  test("wiring: maker cannot trade against own quote (LIMIT throws, MARKET skips)", async () => {
    const contractId = await mkContract();
    const q = await prisma.quote.create({
      data: { contractId, makerId: maker, bid: 30, ask: 40, bidSize: 10, askSize: 10, status: "OPEN" },
    });

    await expect(
      prisma.$transaction((tx) =>
        executeLimitOrder(tx, maker, { contractId, side: "OVER", size: 5, type: "LIMIT", quoteId: q.id })
      )
    ).rejects.toThrow(SelfTradeError);

    const mkt = await prisma.$transaction((tx) =>
      executeMarketOrder(tx, maker, { contractId, side: "OVER", size: 5, type: "MARKET", limitPrice: 100 })
    );
    expect(mkt.totalFilled).toBe(0); // own quote skipped by the sweep
  });
});
