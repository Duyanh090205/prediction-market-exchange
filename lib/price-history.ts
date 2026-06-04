// Price-history recorder — appends a PricePoint whenever a contract's market
// mid moves, and pushes it live to the contract room for the price chart.
//
// Called at the route layer AFTER a fill (orders) or a quote change (quotes),
// reading committed state. It never throws — chart bookkeeping must not break
// the trade/quote flow.

import { prisma } from "./prisma";
import { emitPriceUpdated } from "./socket-events";

/**
 * Compute the current market mid for a contract and record it if it moved.
 *
 * mid =
 *   - midpoint of best bid / best ask when both sides exist AND the book is not
 *     crossed (best bid < best ask)
 *   - else the last traded price (a crossed/locked book has no meaningful
 *     spread mid; the most recent execution is the better signal)
 *   - else the spread midpoint (crossed book, no trades yet — last resort)
 *   - else the single available side
 *   - else nothing to plot (skip)
 */
export async function recordPricePoint(contractId: number): Promise<void> {
  try {
    const openQuotes = await prisma.quote.findMany({
      where: { contractId, status: "OPEN" },
      select: { bid: true, ask: true },
    });

    let bestBid: number | null = null;
    let bestAsk: number | null = null;
    for (const q of openQuotes) {
      if (q.bid != null && (bestBid === null || q.bid > bestBid)) bestBid = q.bid;
      if (q.ask != null && (bestAsk === null || q.ask < bestAsk)) bestAsk = q.ask;
    }

    const lastTradeRow = await prisma.trade.findFirst({
      where: { contractId },
      orderBy: { createdAt: "desc" },
      select: { strike: true },
    });
    const lastTrade = lastTradeRow?.strike ?? null;

    let mid: number | null = null;
    if (bestBid != null && bestAsk != null && bestBid < bestAsk) {
      // Normal book — midpoint of the spread.
      mid = (bestBid + bestAsk) / 2;
    } else if (lastTrade != null) {
      // Crossed/locked book (best bid ≥ best ask — quotes don't auto-match, so a
      // crossing quote can sit in the book) or one side only: the spread midpoint
      // is meaningless or unavailable, so use the last executed price instead.
      mid = lastTrade;
    } else if (bestBid != null && bestAsk != null) {
      // Crossed book with no trades yet — no better signal than the midpoint.
      mid = (bestBid + bestAsk) / 2;
    } else if (bestBid != null) {
      mid = bestBid;
    } else if (bestAsk != null) {
      mid = bestAsk;
    }

    if (mid === null) return; // no book and no trades yet — nothing to plot

    // Dedup: skip if the mid hasn't moved since the last recorded point.
    const last = await prisma.pricePoint.findFirst({
      where: { contractId },
      orderBy: { ts: "desc" },
      select: { mid: true },
    });
    if (last && last.mid === mid) return;

    const point = await prisma.pricePoint.create({
      data: { contractId, mid, lastTrade, bestBid, bestAsk },
    });

    emitPriceUpdated({
      contractId,
      ts: point.ts.toISOString(),
      mid,
      bestBid,
      bestAsk,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        event: "recordPricePoint:failed",
        contractId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
