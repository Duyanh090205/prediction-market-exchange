// Matching Engine — Price-Time Priority CLOB with Double Margining
//
// Both LIMIT (single quote) and MARKET (book sweep) execute under
// SELECT FOR UPDATE inside a Prisma interactive transaction. Margin is
// computed ONCE at entry per side (taker, each maker touched), then
// updated incrementally per fill — no re-querying the full margin state
// inside the loop, which keeps the transaction window tight.

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
  /** For LIMIT orders: the specific quoteId to hit */
  quoteId?: number;
  /** Slippage protection: worst acceptable price. Required for MARKET orders. */
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
  quoteRemainingSize: number;
  quoteStatus: "OPEN" | "EXHAUSTED";
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

// ─── LIMIT ──────────────────────────────────────────────────────────────────

export async function executeLimitOrder(
  tx: Prisma.TransactionClient,
  takerId: number,
  input: OrderInput
): Promise<MatchResult> {
  if (!input.quoteId) throw new Error("LIMIT orders require a quoteId");

  const fills: FillResult[] = [];
  const cancelledQuoteIds: number[] = [];

  const lockedQuotes = await tx.$queryRaw<
    Array<{
      id: number;
      contractId: number;
      makerId: number;
      bid: number | null;
      ask: number | null;
      size: number;
      status: string;
    }>
  >`
    SELECT id, "contractId", "makerId", bid, ask, size, status
    FROM "Quote"
    WHERE id = ${input.quoteId}
    FOR UPDATE
  `;

  const quote = lockedQuotes[0];
  if (!quote || quote.status !== "OPEN") throw new QuoteNotOpenError(input.quoteId);
  if (quote.makerId === takerId) throw new SelfTradeError();
  if (quote.contractId !== input.contractId)
    throw new ContractMismatchError(input.contractId, quote.contractId);

  const strike = input.side === "OVER" ? quote.ask : quote.bid;
  if (strike == null) throw new SideNotOfferedError(input.side);

  const requestedFill = Math.min(input.size, quote.size);

  // Cap by both margin snapshots
  const takerSnap = await snapshotMargin(tx, takerId);
  const makerSnap = await snapshotMargin(tx, quote.makerId);

  const takerCap = maxFillByMargin(
    takerSnap,
    quote.contractId,
    input.side,
    strike,
    true,
    requestedFill
  );
  // Maker takes the opposite side
  const makerSide: OrderSide = input.side === "OVER" ? "UNDER" : "OVER";
  const makerCap = maxFillByMargin(
    makerSnap,
    quote.contractId,
    makerSide,
    strike,
    false,
    requestedFill
  );

  const fillSize = Math.min(takerCap, makerCap);
  if (fillSize <= 0) {
    if (makerCap <= 0) {
      // Toxic quote — cancel it so the book stops advertising what the maker can't honour
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "CANCELLED" },
      });
      cancelledQuoteIds.push(quote.id);
      throw new MakerMarginError(quote.id);
    }
    throw new TakerMarginError(requestedFill, availableFromSnapshot(takerSnap));
  }

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

  const remaining = quote.size - fillSize;
  const quoteStatus = remaining <= 0 ? "EXHAUSTED" : "OPEN";
  await tx.quote.update({
    where: { id: quote.id },
    data: { size: Math.max(remaining, 0), status: quoteStatus },
  });

  fills.push({
    quoteId: quote.id,
    tradeId: trade.id,
    makerId: quote.makerId,
    strike,
    size: fillSize,
    quoteRemainingSize: Math.max(remaining, 0),
    quoteStatus,
  });

  await tx.notification.create({
    data: {
      userId: quote.makerId,
      message: `Your quote was hit — trade #${trade.id} executed (${fillSize} @ ${strike})`,
    },
  });

  return { fills, totalFilled: fillSize, cancelledQuoteIds };
}

// ─── MARKET ─────────────────────────────────────────────────────────────────

export async function executeMarketOrder(
  tx: Prisma.TransactionClient,
  takerId: number,
  input: OrderInput
): Promise<MatchResult> {
  if (input.limitPrice == null)
    throw new Error("MARKET orders require a limitPrice for slippage protection");

  const fills: FillResult[] = [];
  const cancelledQuoteIds: number[] = [];
  let remainingSize = input.size;

  let orderedQuotes: Array<{
    id: number;
    contractId: number;
    makerId: number;
    bid: number | null;
    ask: number | null;
    size: number;
    status: string;
  }>;

  if (input.side === "OVER") {
    orderedQuotes = await tx.$queryRaw`
      SELECT id, "contractId", "makerId", bid, ask, size, status
      FROM "Quote"
      WHERE "contractId" = ${input.contractId}
        AND status = 'OPEN'
        AND ask IS NOT NULL
        AND "makerId" != ${takerId}
      ORDER BY ask ASC, "createdAt" ASC
      FOR UPDATE
    `;
  } else {
    orderedQuotes = await tx.$queryRaw`
      SELECT id, "contractId", "makerId", bid, ask, size, status
      FROM "Quote"
      WHERE "contractId" = ${input.contractId}
        AND status = 'OPEN'
        AND bid IS NOT NULL
        AND "makerId" != ${takerId}
      ORDER BY bid DESC, "createdAt" ASC
      FOR UPDATE
    `;
  }

  // Snapshot taker once — mutate in-memory as fills accumulate
  const takerSnap = await snapshotMargin(tx, takerId);
  const makerSide: OrderSide = input.side === "OVER" ? "UNDER" : "OVER";
  // Per-maker snapshot cache (a maker can own multiple quotes in the book)
  const makerSnaps = new Map<number, CachedMarginState>();

  for (const quote of orderedQuotes) {
    if (remainingSize <= 0) break;

    const strike = input.side === "OVER" ? quote.ask! : quote.bid!;

    // Slippage protection
    if (input.side === "OVER" && strike > input.limitPrice) break;
    if (input.side === "UNDER" && strike < input.limitPrice) break;

    const inventoryCap = Math.min(remainingSize, quote.size);
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

    const makerCap = maxFillByMargin(
      makerSnap,
      input.contractId,
      makerSide,
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

    const quoteRemaining = quote.size - fillSize;
    const quoteStatus = quoteRemaining <= 0 ? "EXHAUSTED" : "OPEN";
    await tx.quote.update({
      where: { id: quote.id },
      data: { size: Math.max(quoteRemaining, 0), status: quoteStatus },
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
      quoteRemainingSize: Math.max(quoteRemaining, 0),
      quoteStatus,
    });

    // Update in-memory snapshots so subsequent caps reflect this fill
    applyFillToSnapshot(takerSnap, input.contractId, input.side, strike, fillSize, true);
    applyFillToSnapshot(makerSnap, input.contractId, makerSide, strike, fillSize, false);

    remainingSize -= fillSize;
  }

  return {
    fills,
    totalFilled: input.size - remainingSize,
    cancelledQuoteIds,
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class QuoteNotOpenError extends Error {
  constructor(quoteId: number) {
    super(`Quote ${quoteId} is no longer open`);
  }
}

export class SelfTradeError extends Error {
  constructor() {
    super("Cannot trade against your own quote");
  }
}

export class SideNotOfferedError extends Error {
  constructor(side: string) {
    super(`Quote does not offer the ${side} side`);
  }
}

export class MakerMarginError extends Error {
  quoteId: number;
  constructor(quoteId: number) {
    super(`Maker on quote ${quoteId} has insufficient margin — quote cancelled`);
    this.quoteId = quoteId;
  }
}

export class ContractMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`Quote belongs to contract ${actual}, not ${expected}`);
  }
}

export class TakerMarginError extends Error {
  constructor(required: number, available: number) {
    super(
      `Insufficient margin: trade requires ${required}, you have ${available} available`
    );
  }
}

// Re-export for callers that need to introspect (tests)
export { calculateAvailableMargin, incrementalWorstCase };
