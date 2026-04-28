/**
 * Matching Engine Test Suite
 *
 * Tests the FIFO sweep algorithm, Double Margining, slippage protection,
 * self-trade prevention, and partial fills.
 *
 * Strategy: We mock the Prisma TransactionClient and the margin calculator
 * so these tests are fully offline and deterministic.
 */

import {
  executeLimitOrder,
  executeMarketOrder,
  QuoteNotOpenError,
  SelfTradeError,
  SideNotOfferedError,
  MakerMarginError,
  ContractMismatchError,
  TakerMarginError,
  type OrderInput,
} from "@/lib/matching-engine";

// ─── Mock per-user balance ─────────────────────────────────────────────────
// Engine now reads margin via tx.user/tx.trade directly (snapshotMargin), so
// we expose balances here and assume zero open trades for the snapshot. Tests
// that need pre-existing positions can set up `mockOpenTrades`.
const mockMargins = new Map<number, number>();
let mockOpenTrades: Array<{
  contractId: number;
  takerSide: "OVER" | "UNDER";
  strike: number;
  size: number;
  takerId: number;
  makerId: number;
  status: string;
}> = [];

// ─── Mock Prisma TransactionClient ─────────────────────────────────────────

let tradeIdCounter = 1;
let mockQuotes: Array<{
  id: number;
  contractId: number;
  makerId: number;
  bid: number | null;
  ask: number | null;
  size: number;
  status: string;
  createdAt: Date;
}> = [];

let createdTrades: Array<Record<string, unknown>> = [];
let updatedQuotes: Array<{ id: number; data: Record<string, unknown> }> = [];
let createdNotifications: Array<Record<string, unknown>> = [];

function createMockTx() {
  return {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");

      // Single quote fetch (LIMIT order)
      if (query.includes("WHERE id =") && query.includes("FOR UPDATE")) {
        const quoteId = values[0] as number;
        const found = mockQuotes.filter((q) => q.id === quoteId);
        return found;
      }

      // Multi-quote fetch (MARKET order sweep)
      if (query.includes("ORDER BY")) {
        const contractId = values[0] as number;
        const takerId = values[1] as number;
        let filtered = mockQuotes.filter(
          (q) =>
            q.contractId === contractId &&
            q.status === "OPEN" &&
            q.makerId !== takerId
        );

        if (query.includes("ask ASC")) {
          // OVER side — lowest ask first
          filtered = filtered
            .filter((q) => q.ask != null)
            .sort((a, b) => a.ask! - b.ask! || a.createdAt.getTime() - b.createdAt.getTime());
        } else if (query.includes("bid DESC")) {
          // UNDER side — highest bid first
          filtered = filtered
            .filter((q) => q.bid != null)
            .sort((a, b) => b.bid! - a.bid! || a.createdAt.getTime() - b.createdAt.getTime());
        }

        return filtered;
      }

      return [];
    }),
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
        const balance = mockMargins.get(where.id) ?? 9999;
        return { balance };
      }),
    },
    trade: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const trade = { id: tradeIdCounter++, ...data };
        createdTrades.push(trade);
        // Also append to mockOpenTrades so subsequent snapshots reflect the fill
        mockOpenTrades.push({
          contractId: data.contractId as number,
          takerSide: data.takerSide as "OVER" | "UNDER",
          strike: data.strike as number,
          size: data.size as number,
          takerId: data.takerId as number,
          makerId: data.makerId as number,
          status: "OPEN",
        });
        return trade;
      }),
      findMany: jest.fn(async ({ where }: { where: { OR?: Array<{ takerId?: number; makerId?: number }> } }) => {
        const ids = (where.OR ?? [])
          .map((c) => c.takerId ?? c.makerId)
          .filter((v): v is number => typeof v === "number");
        return mockOpenTrades.filter(
          (t) => t.status === "OPEN" && ids.some((uid) => t.takerId === uid || t.makerId === uid)
        );
      }),
    },
    quote: {
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        updatedQuotes.push({ id: where.id, data });
        // Also update the mock quote store so subsequent reads see the change
        const idx = mockQuotes.findIndex((q) => q.id === where.id);
        if (idx >= 0) {
          if (data.size != null) mockQuotes[idx].size = data.size as number;
          if (data.status != null) mockQuotes[idx].status = data.status as string;
        }
        return { id: where.id, ...data };
      }),
    },
    notification: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdNotifications.push(data);
        return { id: 1, ...data };
      }),
    },
  } as unknown as Parameters<typeof executeLimitOrder>[0];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeQuote(overrides: Partial<(typeof mockQuotes)[0]> & { id: number; makerId: number }) {
  return {
    contractId: 1,
    bid: null,
    ask: null,
    size: 50,
    status: "OPEN",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  tradeIdCounter = 1;
  mockQuotes = [];
  createdTrades = [];
  updatedQuotes = [];
  createdNotifications = [];
  mockMargins.clear();
  mockOpenTrades = [];
});

// ─── LIMIT ORDER TESTS ────────────────────────────────────────────────────

describe("executeLimitOrder", () => {
  test("fills against a single OPEN quote", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 })];
    const tx = createMockTx();

    const result = await executeLimitOrder(tx, /* takerId */ 1, {
      contractId: 1,
      side: "OVER",
      size: 25,
      type: "LIMIT",
      quoteId: 10,
    });

    expect(result.totalFilled).toBe(25);
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]).toMatchObject({
      quoteId: 10,
      strike: 220,
      size: 25,
      makerId: 2,
      quoteRemainingSize: 25,
      quoteStatus: "OPEN",
    });

    // Quote should be decremented, not exhausted
    const quoteUpdate = updatedQuotes.find((u) => u.id === 10);
    expect(quoteUpdate?.data.size).toBe(25);
    expect(quoteUpdate?.data.status).toBe("OPEN");
  });

  test("fillSize is capped by quote inventory, margin checked against fillSize", async () => {
    // Quote has size 10, taker wants 50, maker has margin 15.
    // fillSize = min(50, 10) = 10. Margin 15 >= 10, so trade succeeds.
    // BUG (pre-fix): compared margin(15) < input.size(50) → would wrongly cancel.
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 10 })];
    mockMargins.set(2, 15);
    const tx = createMockTx();

    const result = await executeLimitOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 50,
      type: "LIMIT",
      quoteId: 10,
    });

    // Should succeed with fill of 10 (not throw MakerMarginError)
    expect(result.totalFilled).toBe(10);
    expect(result.fills[0].size).toBe(10);
    expect(result.fills[0].quoteStatus).toBe("EXHAUSTED");
  });

  test("exhausts quote when taker takes full size", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 25 })];
    const tx = createMockTx();

    const result = await executeLimitOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 25,
      type: "LIMIT",
      quoteId: 10,
    });

    expect(result.totalFilled).toBe(25);
    expect(result.fills[0].quoteStatus).toBe("EXHAUSTED");
    expect(result.fills[0].quoteRemainingSize).toBe(0);
  });

  test("throws SelfTradeError when taker owns the quote", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 1, ask: 220 })];
    const tx = createMockTx();

    await expect(
      executeLimitOrder(tx, 1, {
        contractId: 1,
        side: "OVER",
        size: 10,
        type: "LIMIT",
        quoteId: 10,
      })
    ).rejects.toThrow(SelfTradeError);
  });

  test("throws QuoteNotOpenError for EXHAUSTED quote", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, status: "EXHAUSTED" })];
    const tx = createMockTx();

    await expect(
      executeLimitOrder(tx, 1, {
        contractId: 1,
        side: "OVER",
        size: 10,
        type: "LIMIT",
        quoteId: 10,
      })
    ).rejects.toThrow(QuoteNotOpenError);
  });

  test("throws SideNotOfferedError when quote has no ask for OVER order", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, bid: 200, ask: null })];
    const tx = createMockTx();

    await expect(
      executeLimitOrder(tx, 1, {
        contractId: 1,
        side: "OVER",
        size: 10,
        type: "LIMIT",
        quoteId: 10,
      })
    ).rejects.toThrow(SideNotOfferedError);
  });

  test("partial-fills against maker's available margin instead of throwing", async () => {
    // Real-trading-platform semantics: a maker with limited margin can still
    // honour a smaller fill. We cap to their capacity rather than aborting.
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 })];
    mockMargins.set(2, 5);
    const tx = createMockTx();

    const result = await executeLimitOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 25,
      type: "LIMIT",
      quoteId: 10,
    });

    expect(result.totalFilled).toBe(5);
    expect(result.fills[0].size).toBe(5);
  });

  test("cancels toxic quote when maker has zero margin", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 })];
    mockMargins.set(2, 0); // Maker has nothing — cannot honour any size
    const tx = createMockTx();

    await expect(
      executeLimitOrder(tx, 1, {
        contractId: 1,
        side: "OVER",
        size: 25,
        type: "LIMIT",
        quoteId: 10,
      })
    ).rejects.toThrow(MakerMarginError);

    const quoteUpdate = updatedQuotes.find((u) => u.id === 10);
    expect(quoteUpdate?.data.status).toBe("CANCELLED");
  });

  test("throws ContractMismatchError when quote belongs to different contract (S1)", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, contractId: 5 })];
    const tx = createMockTx();

    await expect(
      executeLimitOrder(tx, 1, {
        contractId: 999, // Mismatched!
        side: "OVER",
        size: 10,
        type: "LIMIT",
        quoteId: 10,
      })
    ).rejects.toThrow(ContractMismatchError);
  });

  test("LIMIT partial-fills to taker's available margin", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 })];
    mockMargins.set(1, 5); // Taker (id=1) only has 5 margin
    const tx = createMockTx();

    const result = await executeLimitOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 25,
      type: "LIMIT",
      quoteId: 10,
    });

    expect(result.totalFilled).toBe(5);
    expect(result.fills[0].size).toBe(5);
  });

  test("LIMIT throws TakerMarginError when taker has zero margin", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 })];
    mockMargins.set(1, 0);
    const tx = createMockTx();

    await expect(
      executeLimitOrder(tx, 1, {
        contractId: 1,
        side: "OVER",
        size: 25,
        type: "LIMIT",
        quoteId: 10,
      })
    ).rejects.toThrow(TakerMarginError);
  });

  test("creates a notification for the maker", async () => {
    mockQuotes = [makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 })];
    const tx = createMockTx();

    await executeLimitOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 10,
      type: "LIMIT",
      quoteId: 10,
    });

    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0].userId).toBe(2);
  });
});

// ─── MARKET ORDER (SWEEP) TESTS ───────────────────────────────────────────

describe("executeMarketOrder", () => {
  test("Price-Time Priority: fills cheapest ask first, then by createdAt", async () => {
    mockQuotes = [
      makeQuote({ id: 11, makerId: 3, ask: 230, size: 50, createdAt: new Date("2026-01-01T00:00:00Z") }),
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 50, createdAt: new Date("2026-01-02T00:00:00Z") }),
      makeQuote({ id: 12, makerId: 4, ask: 220, size: 50, createdAt: new Date("2026-01-01T00:00:00Z") }),
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 30,
      type: "MARKET",
      limitPrice: 250,
    });

    // Should fill from quote 12 first (ask=220, oldest), then quote 10 (ask=220, newer)
    // Total 30 from quote 12 alone since it has size 50
    expect(result.totalFilled).toBe(30);
    expect(result.fills[0].quoteId).toBe(12); // Oldest at price 220
  });

  test("Partial fill: book only has 30 but taker wants 50", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 20 }),
      makeQuote({ id: 11, makerId: 3, ask: 225, size: 10 }),
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 50,
      type: "MARKET",
      limitPrice: 300,
    });

    expect(result.totalFilled).toBe(30); // Only 30 available
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0]).toMatchObject({ quoteId: 10, size: 20, strike: 220 });
    expect(result.fills[1]).toMatchObject({ quoteId: 11, size: 10, strike: 225 });
  });

  test("Taker margin exhaustion: stops when taker runs out of margin", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 100 }),
    ];
    // Taker has margin for only 40, but the engine receives the full size.
    // The sweep should cap fill at maker's margin capacity in this path,
    // but the submission check in the route handler catches this first.
    // Here we test that fillSize = min(remainingSize, quoteSize, makerMargin).
    mockMargins.set(2, 40); // Maker can only cover 40
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 50,
      type: "MARKET",
      limitPrice: 300,
    });

    // fillSize = min(50, 100, 40) = 40
    expect(result.totalFilled).toBe(40);
    expect(result.fills[0].size).toBe(40);
  });

  test("Maker margin failure (toxic quote): auto-cancels and continues sweep", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 50 }), // Toxic — maker has 0 margin
      makeQuote({ id: 11, makerId: 3, ask: 225, size: 50 }), // Healthy
    ];
    mockMargins.set(2, 0); // Maker 2 is broke
    mockMargins.set(3, 9999); // Maker 3 is fine
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 30,
      type: "MARKET",
      limitPrice: 300,
    });

    // Quote 10 should be cancelled, fill should come from quote 11
    expect(result.cancelledQuoteIds).toContain(10);
    expect(result.totalFilled).toBe(30);
    expect(result.fills[0]).toMatchObject({ quoteId: 11, strike: 225, size: 30 });
  });

  test("Slippage protection: stops sweep at limitPrice boundary", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 25 }),
      makeQuote({ id: 11, makerId: 3, ask: 230, size: 25 }),
      makeQuote({ id: 12, makerId: 4, ask: 250, size: 25 }), // Beyond limit
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 75,
      type: "MARKET",
      limitPrice: 235, // Only willing to pay up to 235
    });

    // Should fill quotes 10 (220) and 11 (230), but NOT 12 (250)
    expect(result.totalFilled).toBe(50);
    expect(result.fills).toHaveLength(2);
    expect(result.fills.map((f) => f.quoteId)).toEqual([10, 11]);
  });

  test("Self-trade prevention: skips taker's own quotes in sweep", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 1, ask: 220, size: 50 }), // Taker's own quote
      makeQuote({ id: 11, makerId: 2, ask: 225, size: 50 }), // Someone else's
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 30,
      type: "MARKET",
      limitPrice: 300,
    });

    // Should skip quote 10 (self-trade) and fill from quote 11
    expect(result.totalFilled).toBe(30);
    expect(result.fills[0].quoteId).toBe(11);
  });

  test("UNDER side: fills highest bid first", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, bid: 200, size: 50 }),
      makeQuote({ id: 11, makerId: 3, bid: 210, size: 50 }),
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "UNDER",
      size: 30,
      type: "MARKET",
      limitPrice: 190,
    });

    // Should fill from quote 11 first (bid=210, best for UNDER taker)
    expect(result.totalFilled).toBe(30);
    expect(result.fills[0]).toMatchObject({ quoteId: 11, strike: 210, size: 30 });
  });

  test("UNDER side: slippage protection stops at limitPrice (T2)", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, bid: 210, size: 25 }),
      makeQuote({ id: 11, makerId: 3, bid: 200, size: 25 }),
      makeQuote({ id: 12, makerId: 4, bid: 180, size: 25 }), // Beyond limit
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "UNDER",
      size: 75,
      type: "MARKET",
      limitPrice: 195, // Won't accept bids below 195
    });

    // Should fill quotes 10 (210) and 11 (200), but NOT 12 (180)
    expect(result.totalFilled).toBe(50);
    expect(result.fills).toHaveLength(2);
    expect(result.fills.map((f) => f.quoteId)).toEqual([10, 11]);
  });

  test("Taker margin exhaustion mid-sweep (D3)", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 100 }),
    ];
    mockMargins.set(1, 20); // Taker only has 20 margin
    mockMargins.set(2, 9999); // Maker is fine
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 50,
      type: "MARKET",
      limitPrice: 300,
    });

    // Should cap at taker's available margin (20)
    expect(result.totalFilled).toBe(20);
    expect(result.fills[0].size).toBe(20);
  });

  test("Empty book: returns zero fills", async () => {
    mockQuotes = []; // No quotes
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 50,
      type: "MARKET",
      limitPrice: 300,
    });

    expect(result.totalFilled).toBe(0);
    expect(result.fills).toHaveLength(0);
  });

  test("Multi-quote sweep exhausts first quote and partially fills second", async () => {
    mockQuotes = [
      makeQuote({ id: 10, makerId: 2, ask: 220, size: 30 }),
      makeQuote({ id: 11, makerId: 3, ask: 225, size: 50 }),
    ];
    const tx = createMockTx();

    const result = await executeMarketOrder(tx, 1, {
      contractId: 1,
      side: "OVER",
      size: 45,
      type: "MARKET",
      limitPrice: 300,
    });

    expect(result.totalFilled).toBe(45);
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0]).toMatchObject({ quoteId: 10, size: 30, strike: 220 });
    expect(result.fills[1]).toMatchObject({ quoteId: 11, size: 15, strike: 225 });

    // First quote should be EXHAUSTED
    const q10Update = updatedQuotes.find((u) => u.id === 10);
    expect(q10Update?.data.status).toBe("EXHAUSTED");

    // Second quote should still be OPEN with decremented size
    const q11Update = updatedQuotes.find((u) => u.id === 11);
    expect(q11Update?.data.status).toBe("OPEN");
    expect(q11Update?.data.size).toBe(35);
  });
});
