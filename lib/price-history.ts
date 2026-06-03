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
 *   - midpoint of best bid / best ask when both sides exist
 *   - else the last traded price (strike of the most recent trade)
 *   - else the single available side
 *   - else nothing to plot (skip)
 *
 * (Polymarket additionally falls back to last-trade when the spread is very
 * wide; left as a future tweak — the threshold is platform-specific.)
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
    if (bestBid != null && bestAsk != null) {
      mid = (bestBid + bestAsk) / 2;
    } else if (lastTrade != null) {
      mid = lastTrade;
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
