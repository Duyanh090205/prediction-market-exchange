// Matching Engine — Price-Time Priority CLOB with Double Margining
//
// One execution primitive: sweep the book best-price-first up to a price cap,
// under SELECT FOR UPDATE inside a Prisma interactive transaction. Both order
// types route through it: MARKET (cap = price-band edge) and LIMIT (cap = the
// user's limit; the unfilled remainder rests in the book as a one-sided quote
// — see orderService). Crossing quotes also auto-match through it (see
// quoteService). The resting (first-submitted) order's price is always the
// trade price. Margin is computed ONCE at entry per side (taker, each maker
// touched), then updated incrementally per fill.

import { Prisma } from "@prisma/client";
import {
  calculateAvailableMargin,
  worstCaseForContract,
  incrementalWorstCase,
} from "@/lib/margin";

export type OrderType = "LIMIT" | "MARKET";
export type OrderSide = "OVER" | "UNDER";

export interface OrderInput {
  contractId: number;
  side: OrderSide;
  size: number;
  type: OrderType;
  /** Worst acceptable price (band edge for MARKET, the user's limit for LIMIT). */
  limitPrice?: number;
  /** Idempotency key from request — also stored on Trade rows for hard dedup */
  idempotencyKey?: string;
}

export interface FillResult {
  quoteId: number;
  tradeId: number;
  makerId: number;
  strike: number;
  size: number;
  /** Remaining inventory on the side that was just hit. */
  quoteRemainingSize: number;
  /** Post-fill per-side inventory (null = that side not offered). */
  quoteBidSize: number | null;
  quoteAskSize: number | null;
  quoteStatus: "OPEN" | "EXHAUSTED";
}

/**
 * A quote stays OPEN while at least one priced side still has inventory;
 * otherwise it is EXHAUSTED.
 */
function liveStatus(
  bid: number | null,
  ask: number | null,
  bidSize: number,
  askSize: number
): "OPEN" | "EXHAUSTED" {
  const live = (bid != null && bidSize > 0) || (ask != null && askSize > 0);
  return live ? "OPEN" : "EXHAUSTED";
}

export interface MatchResult {
  fills: FillResult[];
  totalFilled: number;
  cancelledQuoteIds: number[];
}

interface SnapshotPosition {
  takerSide: OrderSide;
  strike: number;
  size: number;
  isAsTaker: boolean;
}

interface CachedMarginState {
  balance: number;
  positionsByContract: Map<number, SnapshotPosition[]>;
}

/**
 * Snapshot of a user's margin-relevant state, suitable for in-loop
 * incremental updates. Reads `User.balance` and all OPEN trades.
 */
async function snapshotMargin(
  tx: Prisma.TransactionClient,
  userId: number
): Promise<CachedMarginState> {
  const [user, trades] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { balance: true } }),
    tx.trade.findMany({
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
    }),
  ]);
  if (!user) throw new Error(`User ${userId} not found`);

  const positionsByContract = new Map<number, SnapshotPosition[]>();
  for (const t of trades) {
    const list = positionsByContract.get(t.contractId) ?? [];
    list.push({
      takerSide: t.takerSide as OrderSide,
      strike: t.strike,
      size: t.size,
      isAsTaker: t.takerId === userId,
    });
    positionsByContract.set(t.contractId, list);
  }
  return { balance: user.balance, positionsByContract };
}

function availableFromSnapshot(s: CachedMarginState): number {
  let worst = 0;
  for (const positions of s.positionsByContract.values()) {
    worst += worstCaseForContract(positions);
  }
  return s.balance + worst;
}

/**
 * Largest fill (in contract units) that user can absorb on this contract
 * given their cached margin snapshot, where the new position is taken on
 * the indicated side at the given strike.
 *
 * Uses binary search on the incremental worst-case impact, since for a
 * single contract that impact is monotone non-increasing in fill size.
 */
function maxFillByMargin(
  snapshot: CachedMarginState,
  contractId: number,
  side: OrderSide,
  strike: number,
  isAsTaker: boolean,
  upper: number
): number {
  if (upper <= 0) return 0;
  const existing = snapshot.positionsByContract.get(contractId) ?? [];
  const otherWorst =
    availableFromSnapshot(snapshot) -
    snapshot.balance -
    worstCaseForContract(existing); // worst contributed by other contracts (≤0)
  const balancePlusOthers = snapshot.balance + otherWorst;

  // Feasibility check at upper
  const upperImpact = worstCaseForContract([
    ...existing,
    { takerSide: side, strike, size: upper, isAsTaker },
  ]);
  if (balancePlusOthers + upperImpact >= 0) return upper;

  // Binary search for largest feasible size in [0, upper]
  let lo = 0;
  let hi = upper;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const impact = worstCaseForContract([
      ...existing,
      { takerSide: side, strike, size: mid, isAsTaker },
    ]);
    if (balancePlusOthers + impact >= 0) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function applyFillToSnapshot(
  snapshot: CachedMarginState,
  contractId: number,
  side: OrderSide,
  strike: number,
  size: number,
  isAsTaker: boolean
): void {
  const list = snapshot.positionsByContract.get(contractId) ?? [];
  list.push({ takerSide: side, strike, size, isAsTaker });
  snapshot.positionsByContract.set(contractId, list);
}

// ─── SWEEP (the single execution primitive) ─────────────────────────────────

export async function executeMarketOrder(
  tx: Prisma.TransactionClient,
  takerId: number,
  input: OrderInput
): Promise<MatchResult> {
  if (input.limitPrice == null)
    throw new Error("Sweeps require a limitPrice (band edge for MARKET orders)");

  const fills: FillResult[] = [];
  const cancelledQuoteIds: number[] = [];
  let remainingSize = input.size;

  let orderedQuotes: Array<{
    id: number;
    contractId: number;
    makerId: number;
    bid: number | null;
    ask: number | null;
    bidSize: number | null;
    askSize: number | null;
    status: string;
  }>;

  if (input.side === "OVER") {
    // Best (lowest) ask first; only quotes with live ask inventory.
    orderedQuotes = await tx.$queryRaw`
      SELECT id, "contractId", "makerId", bid, ask, "bidSize", "askSize", status
      FROM "Quote"
      WHERE "contractId" = ${input.contractId}
        AND status = 'OPEN'
        AND ask IS NOT NULL
        AND "askSize" > 0
        AND "makerId" != ${takerId}
      ORDER BY ask ASC, "createdAt" ASC
      FOR UPDATE
    `;
  } else {
    // Best (highest) bid first; only quotes with live bid inventory.
    orderedQuotes = await tx.$queryRaw`
      SELECT id, "contractId", "makerId", bid, ask, "bidSize", "askSize", status
      FROM "Quote"
      WHERE "contractId" = ${input.contractId}
        AND status = 'OPEN'
        AND bid IS NOT NULL
        AND "bidSize" > 0
        AND "makerId" != ${takerId}
      ORDER BY bid DESC, "createdAt" ASC
      FOR UPDATE
    `;
  }

  // Snapshot taker once — mutate in-memory as fills accumulate
  const takerSnap = await snapshotMargin(tx, takerId);
  // Per-maker snapshot cache (a maker can own multiple quotes in the book)
  const makerSnaps = new Map<number, CachedMarginState>();

  for (const quote of orderedQuotes) {
    if (remainingSize <= 0) break;

    const strike = input.side === "OVER" ? quote.ask! : quote.bid!;
    const sideInventory = input.side === "OVER" ? quote.askSize ?? 0 : quote.bidSize ?? 0;
    if (sideInventory <= 0) continue;

    // Slippage protection
    if (input.side === "OVER" && strike > input.limitPrice) break;
    if (input.side === "UNDER" && strike < input.limitPrice) break;

    const inventoryCap = Math.min(remainingSize, sideInventory);
    const takerCap = maxFillByMargin(
      takerSnap,
      input.contractId,
      input.side,
      strike,
      true,
      inventoryCap
    );
    if (takerCap <= 0) {
      // Taker is fully utilized — stop sweep
      break;
    }

    let makerSnap = makerSnaps.get(quote.makerId);
    if (!makerSnap) {
      makerSnap = await snapshotMargin(tx, quote.makerId);
      makerSnaps.set(quote.makerId, makerSnap);
    }

    // Model the maker's leg with the ACTUAL taker side (input.side) and
    // isAsTaker=false — exactly how snapshotMargin records committed trades.
    // pnlForUser negates for isAsTaker=false, so this yields the maker's true
    // P&L. (Passing the maker's OWN side here would flip the sign, making a
    // risk-reducing hedge look like a doubling and falsely cancel the quote.)
    const makerCap = maxFillByMargin(
      makerSnap,
      input.contractId,
      input.side,
      strike,
      false,
      Math.min(inventoryCap, takerCap)
    );
    if (makerCap <= 0) {
      // Toxic quote — cancel and continue sweeping
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "CANCELLED" },
      });
      cancelledQuoteIds.push(quote.id);
      continue;
    }

    const fillSize = Math.min(takerCap, makerCap);
    if (fillSize <= 0) continue;

    const trade = await tx.trade.create({
      data: {
        contractId: input.contractId,
        quoteId: quote.id,
        takerId,
        makerId: quote.makerId,
        takerSide: input.side,
        strike,
        size: fillSize,
        status: "OPEN",
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    // Decrement only the side that was swept; the other side is untouched.
    const curBidSize = quote.bidSize ?? 0;
    const curAskSize = quote.askSize ?? 0;
    const newBidSize = input.side === "UNDER" ? curBidSize - fillSize : curBidSize;
    const newAskSize = input.side === "OVER" ? curAskSize - fillSize : curAskSize;
    const finalBidSize = quote.bid != null ? Math.max(newBidSize, 0) : null;
    const finalAskSize = quote.ask != null ? Math.max(newAskSize, 0) : null;
    const quoteRemaining = Math.max(input.side === "OVER" ? newAskSize : newBidSize, 0);
    const quoteStatus = liveStatus(quote.bid, quote.ask, newBidSize, newAskSize);
    await tx.quote.update({
      where: { id: quote.id },
      data: { bidSize: finalBidSize, askSize: finalAskSize, status: quoteStatus },
    });

    await tx.notification.create({
      data: {
        userId: quote.makerId,
        message: `Your quote was hit — trade #${trade.id} (${fillSize} @ ${strike})`,
      },
    });

    fills.push({
      quoteId: quote.id,
      tradeId: trade.id,
      makerId: quote.makerId,
      strike,
      size: fillSize,
      quoteRemainingSize: quoteRemaining,
      quoteBidSize: finalBidSize,
      quoteAskSize: finalAskSize,
      quoteStatus,
    });

    // Update in-memory snapshots so subsequent caps reflect this fill. The maker
    // leg is recorded with the ACTUAL taker side (input.side) + isAsTaker=false,
    // matching snapshotMargin's convention (see the maxFillByMargin note above).
    applyFillToSnapshot(takerSnap, input.contractId, input.side, strike, fillSize, true);
    applyFillToSnapshot(makerSnap, input.contractId, input.side, strike, fillSize, false);

    remainingSize -= fillSize;
  }

  return {
    fills,
    totalFilled: input.size - remainingSize,
    cancelledQuoteIds,
  };
}

// Re-export for callers that need to introspect (tests)
export { calculateAvailableMargin, incrementalWorstCase };
