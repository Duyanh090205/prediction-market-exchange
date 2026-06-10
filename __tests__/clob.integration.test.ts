/**
 * CLOB behaviors (Sam round 2) — real Postgres, exercising the actual service
 * layer (placeOrder / postQuote), not just the engine:
 *
 *  1. LIMIT order remainder RESTS in the book as a one-sided quote at the limit
 *     price (buy OVER → bid; buy UNDER → ask).
 *  2. Crossing quotes ALWAYS auto-match, at the RESTING order's price.
 *  3. MARKET orders need no limitPrice (default = band edge).
 *
 * Gated behind RUN_DB_ITEST=1.
 */

import { PrismaClient } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { placeOrder } from "@/lib/orderService";
import { postQuote } from "@/lib/quoteService";

const RUN = process.env.RUN_DB_ITEST === "1";
const d = RUN ? describe : describe.skip;
const prisma = RUN ? new PrismaClient() : (null as unknown as PrismaClient);

d("CLOB: resting limit orders + crossing quotes (real Postgres)", () => {
  let A = 0; // poster of resting orders
  let B = 0; // counterparty

  async function mkUser(tag: string, balance: number) {
    const s = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
    const u = await prisma.user.create({
      data: { username: `clob_${tag}_${s}`, email: `clob_${tag}_${s}@test.local`, hashedPassword: "x", role: "USER", status: "ACTIVE", balance },
    });
    return u.id;
  }

  async function mkContract() {
    const c = await prisma.contract.create({
      data: { title: `CLOB ${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`, description: "x", status: "OPEN", minPrice: 0, maxPrice: 100 },
    });
    return c.id;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function order(actorId: number, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = await placeOrder({ actorId, userRole: "USER", body, idempotencyKey: uuidv7() });
    return { status: res.status, body: await res.json() };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function quote(actorId: number, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = await postQuote({ actorId, userRole: "USER", body });
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    A = await mkUser("a", 1_000_000);
    B = await mkUser("b", 1_000_000);
  });

  afterAll(async () => {
    const contracts = await prisma.contract.findMany({ where: { title: { startsWith: "CLOB " } }, select: { id: true } });
    const ids = contracts.map((c) => c.id);
    if (ids.length) {
      await prisma.trade.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.quote.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.pricePoint.deleteMany({ where: { contractId: { in: ids } } });
      await prisma.idempotencyKey.deleteMany({ where: { actorId: { in: [A, B] } } });
      await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.notification.deleteMany({ where: { user: { username: { startsWith: "clob_" } } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: "clob_" } } });
    await prisma.$disconnect();
  });

  test("LIMIT on an empty book rests fully as a one-sided quote at the limit price", async () => {
    const contractId = await mkContract();

    const r = await order(A, { contractId, type: "LIMIT", side: "OVER", size: 12, limitPrice: 60 });
    expect(r.status).toBe(200);
    expect(r.body.totalFilled).toBe(0);
    expect(r.body.resting).toMatchObject({ price: 60, size: 12 });

    // Resting buy-OVER = bid-only quote owned by the orderer.
    const q = await prisma.quote.findUnique({ where: { id: r.body.resting.quoteId } });
    expect(q).toMatchObject({ makerId: A, bid: 60, bidSize: 12, ask: null, askSize: null, status: "OPEN" });
  });

  test("LIMIT sweeps what's within the price, rests the remainder", async () => {
    const contractId = await mkContract();
    // B offers OVER at 55 ×5 (ask-only quote).
    await quote(B, { contractId, ask: 55, askSize: 5 });

    const r = await order(A, { contractId, type: "LIMIT", side: "OVER", size: 12, limitPrice: 60 });
    expect(r.status).toBe(200);
    expect(r.body.totalFilled).toBe(5);
    expect(r.body.fills[0].strike).toBe(55); // resting order's price honored
    expect(r.body.resting).toMatchObject({ price: 60, size: 7 });
  });

  test("LIMIT UNDER remainder rests as an ask-only quote", async () => {
    const contractId = await mkContract();

    const r = await order(A, { contractId, type: "LIMIT", side: "UNDER", size: 8, limitPrice: 45 });
    expect(r.status).toBe(200);
    expect(r.body.resting).toMatchObject({ price: 45, size: 8 });

    const q = await prisma.quote.findUnique({ where: { id: r.body.resting.quoteId } });
    expect(q).toMatchObject({ makerId: A, ask: 45, askSize: 8, bid: null, bidSize: null, status: "OPEN" });
  });

  test("crossing quote auto-matches at the RESTING order's price; book never crossed", async () => {
    const contractId = await mkContract();
    // A rests a bid at 40 ×25 (via a LIMIT OVER order).
    const rest = await order(A, { contractId, type: "LIMIT", side: "OVER", size: 25, limitPrice: 40 });
    expect(rest.body.resting).toMatchObject({ price: 40, size: 25 });

    // B posts an ask at 35 ×10 — crosses the resting bid 40 → trades at 40.
    const r = await quote(B, { contractId, ask: 35, askSize: 10 });
    expect(r.status).toBe(201);
    expect(r.body.matched.totalFilled).toBe(10);
    expect(r.body.matched.fills[0].strike).toBe(40); // first-submitted price honored
    expect(r.body.quote).toBeNull(); // fully matched — nothing rests

    // The resting bid is decremented; no crossed levels remain.
    const q = await prisma.quote.findUnique({ where: { id: rest.body.resting.quoteId } });
    expect(q?.bidSize).toBe(15);
    const trade = await prisma.trade.findFirst({ where: { contractId }, orderBy: { id: "desc" } });
    expect(trade).toMatchObject({ takerId: B, makerId: A, takerSide: "UNDER", strike: 40, size: 10 });
  });

  test("crossing quote partially matches and rests the remainder at its own price", async () => {
    const contractId = await mkContract();
    // A rests bid 40 ×5.
    await order(A, { contractId, type: "LIMIT", side: "OVER", size: 5, limitPrice: 40 });

    // B posts ask 35 ×8 → 5 match @40, 3 rest at ask 35.
    const r = await quote(B, { contractId, ask: 35, askSize: 8 });
    expect(r.body.matched.totalFilled).toBe(5);
    expect(r.body.matched.fills[0].strike).toBe(40);
    expect(r.body.quote).toMatchObject({ ask: 35, askSize: 3 });
  });

  test("two-sided quote: crossing side fills, the other side rests", async () => {
    const contractId = await mkContract();
    // A rests an ask at 50 ×4 (via LIMIT UNDER @50).
    await order(A, { contractId, type: "LIMIT", side: "UNDER", size: 4, limitPrice: 50 });

    // B posts a two-sided quote bid 51 / ask 60. The bid crosses A's resting
    // ask 50 → trades @50 (resting price). The ask 60 doesn't cross → rests.
    const r = await quote(B, { contractId, bid: 51, ask: 60, bidSize: 4, askSize: 6 });
    expect(r.status).toBe(201);
    expect(r.body.matched.bidFilled).toBe(4);
    expect(r.body.matched.askFilled).toBe(0);
    expect(r.body.matched.fills[0].strike).toBe(50); // resting order's price honored
    expect(r.body.quote).toMatchObject({ bid: 51, bidSize: 0, ask: 60, askSize: 6 });
  });

  test("MARKET order without limitPrice fills at best available (band-edge default)", async () => {
    const contractId = await mkContract();
    await quote(B, { contractId, ask: 62, askSize: 10 });

    const r = await order(A, { contractId, type: "MARKET", side: "OVER", size: 6 });
    expect(r.status).toBe(200);
    expect(r.body.totalFilled).toBe(6);
    expect(r.body.fills[0].strike).toBe(62);
    expect(r.body.resting).toBeNull(); // market orders never rest
  });

  test("legacy quoteId targeting is rejected with a clear error", async () => {
    const contractId = await mkContract();
    const r = await order(A, { contractId, type: "LIMIT", side: "OVER", size: 5, quoteId: 1, limitPrice: 50 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("quoteId");
  });
});
