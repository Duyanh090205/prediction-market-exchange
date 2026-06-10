// Shared post-fill side effects — the ONE place that turns a MatchResult into
// user-visible signals (taker notification + websocket pushes). Used by both
// order placement (lib/orderService) and crossing-quote auto-match
// (lib/quoteService) so the two entry points can never drift apart.
//
// Runs AFTER the matching transaction commits — emits must never observe (or
// roll back with) uncommitted state.

import { prisma } from "@/lib/prisma";
import { emitTradeExecuted, emitQuoteUpdated } from "@/lib/socket-events";
import type { MatchResult, OrderSide } from "@/lib/matching-engine";

export async function broadcastFills(params: {
  takerId: number;
  contractId: number;
  contractTitle: string;
  side: OrderSide;
  result: MatchResult;
}): Promise<void> {
  const { takerId, contractId, contractTitle, side, result } = params;

  if (result.totalFilled > 0) {
    const fillSummary = result.fills.map((f) => `${f.size}@${f.strike}`).join(", ");
    await prisma.notification.create({
      data: {
        userId: takerId,
        message: `Order filled: ${result.totalFilled} total (${fillSummary}) on "${contractTitle}"`,
      },
    });
  }

  for (const fill of result.fills) {
    emitTradeExecuted({
      tradeId: fill.tradeId,
      contractId,
      quoteId: fill.quoteId,
      takerId,
      makerId: fill.makerId,
      takerSide: side,
      strike: fill.strike,
      size: fill.size,
    });
  }

  // Swept quotes: push their post-fill per-side inventory.
  for (const fill of result.fills) {
    emitQuoteUpdated({
      quoteId: fill.quoteId,
      contractId,
      bidSize: fill.quoteBidSize,
      askSize: fill.quoteAskSize,
      status: fill.quoteStatus,
    });
  }
  for (const cancelledId of result.cancelledQuoteIds) {
    emitQuoteUpdated({
      quoteId: cancelledId,
      contractId,
      bidSize: 0,
      askSize: 0,
      status: "CANCELLED",
    });
  }
}
