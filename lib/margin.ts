// Margin calculator — Available Margin = Balance + Worst-Case P&L
//
// Binary spread bet: each unit of size pays ±1 coin (fixed). Worst-case loss
// per contract is therefore -size, but with multiple positions on the same
// contract we must sweep test points across all strikes — including each
// strike itself (push case) — to find the true minimum.
//
// Accepts an optional Prisma TransactionClient so margin reads can happen
// inside a SELECT FOR UPDATE transaction.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type PrismaLike = Prisma.TransactionClient | typeof prisma;

interface TradePosition {
  takerSide: "OVER" | "UNDER";
  strike: number;
  size: number;
  isAsTaker: boolean;
}

function pnlForUser(pos: TradePosition, testPoint: number): number {
  const { takerSide, strike, size, isAsTaker } = pos;
  let takerPnl: number;
  if (takerSide === "OVER") {
    takerPnl = testPoint > strike ? size : testPoint < strike ? -size : 0;
  } else {
    takerPnl = testPoint < strike ? size : testPoint > strike ? -size : 0;
  }
  return isAsTaker ? takerPnl : -takerPnl;
}

/**
 * Worst-case P&L (negative or zero) across all positions on a single contract.
 *
 * Test points include: every strike (captures push case), the midpoint between
 * each adjacent pair (captures any non-monotonic minima), and the boundaries
 * one tick outside the strike range (captures unbounded settlement).
 */
export function worstCaseForContract(positions: TradePosition[]): number {
  if (positions.length === 0) return 0;

  const strikes = [...new Set(positions.map((p) => p.strike))].sort(
    (a, b) => a - b
  );

  const testPoints: number[] = [];
  testPoints.push(strikes[0] - 1);
  for (let i = 0; i < strikes.length; i++) {
    testPoints.push(strikes[i]);
    if (i < strikes.length - 1) {
      testPoints.push(Math.floor((strikes[i] + strikes[i + 1]) / 2));
    }
  }
  testPoints.push(strikes[strikes.length - 1] + 1);

  let worst = Infinity;
  for (const tp of testPoints) {
    const pnl = positions.reduce((sum, pos) => sum + pnlForUser(pos, tp), 0);
    worst = Math.min(worst, pnl);
  }
  return worst;
}

/**
 * Available margin for placing new orders.
 *
 *   availableMargin = balance + sum(worstCasePerContract for OPEN trades)
 *
 * Returned in coin units. Since binary spread bets pay ±1 per size unit,
 * 1 coin of available margin permits exactly 1 unit of new size on a
 * fresh contract (or less if it overlaps existing positions in adverse
 * direction).
 */
export async function calculateAvailableMargin(
  userId: number,
  client?: PrismaLike
): Promise<number> {
  const db = client ?? prisma;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { balance: true },
  });
  if (!user) throw new Error(`User ${userId} not found`);

  const trades = await db.trade.findMany({
    where: {
      status: "OPEN",
      OR: [{ takerId: userId }, { makerId: userId }],
    },
    select: {
      contractId: true,
      takerSide: true,
      strike: true,
      size: true,
      takerId: true,
    },
  });

  const byContract = new Map<number, TradePosition[]>();
  for (const trade of trades) {
    const list = byContract.get(trade.contractId) ?? [];
    list.push({
      takerSide: trade.takerSide as "OVER" | "UNDER",
      strike: trade.strike,
      size: trade.size,
      isAsTaker: trade.takerId === userId,
    });
    byContract.set(trade.contractId, list);
  }

  let totalWorstCase = 0;
  for (const positions of byContract.values()) {
    totalWorstCase += worstCaseForContract(positions);
  }

  return user.balance + totalWorstCase;
}

/**
 * Pre-compute incremental worst-case impact of adding `addSize` units to
 * an existing contract position. Returns a non-positive number representing
 * the *additional* margin that would be locked.
 *
 * Used by the matching engine to cap fills without re-querying the full
 * margin state on every iteration of a sweep.
 */
export function incrementalWorstCase(
  existingPositions: TradePosition[],
  candidate: TradePosition
): number {
  const before = worstCaseForContract(existingPositions);
  const after = worstCaseForContract([...existingPositions, candidate]);
  return after - before; // ≤ 0
}

/**
 * Pure version for unit testing.
 */
export function calculateAvailableMarginPure(
  balance: number,
  trades: Array<{
    contractId: number;
    takerSide: "OVER" | "UNDER";
    strike: number;
    size: number;
    takerId: number;
  }>,
  userId: number
): number {
  const byContract = new Map<number, TradePosition[]>();
  for (const trade of trades) {
    const list = byContract.get(trade.contractId) ?? [];
    list.push({
      takerSide: trade.takerSide,
      strike: trade.strike,
      size: trade.size,
      isAsTaker: trade.takerId === userId,
    });
    byContract.set(trade.contractId, list);
  }

  let totalWorstCase = 0;
  for (const positions of byContract.values()) {
    totalWorstCase += worstCaseForContract(positions);
  }
  return balance + totalWorstCase;
}
