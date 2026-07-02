// Shared post-fill side effects — the ONE place that turns a MatchResult into
// user-visible signals (taker notification + websocket pushes). Used by both
// order placement (lib/orderService) and crossing-quote auto-match
// (lib/quoteService) so the two entry points can never drift apart.
//
// Runs AFTER the matching transaction commits — emits must never observe (or
// roll back with) uncommitted state.

import { prisma } from "@/lib/prisma";
import { emitTradeExecuted, emitQuoteUpdated } from "@/lib/socket-events";
import { enqueueDiscordEvent, enqueueDiscordDM } from "@/lib/discord/outbox";
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

    // Mirror the fill to the Discord channel feed (one post per order, not per
    // trade, to avoid spamming on a multi-quote sweep). dedupeKey keyed on the
    // first fill's unique tradeId so an accidental re-broadcast can't double-post.
    await enqueueDiscordEvent(
      "TRADE_EXECUTED",
      {
        contractId,
        contractTitle,
        side,
        totalFilled: result.totalFilled,
        fills: result.fills.map((f) => ({ size: f.size, strike: f.strike })),
      },
      { dedupeKey: `order-fill:${result.fills[0].tradeId}` }
    );

    // Personal DM to the taker — only if they've linked Discord (resolve here so
    // the bot never needs DB access; unlinked users simply get no DM). Best-effort:
    // a Discord/DB hiccup here must never fail an already-committed trade.
    try {
      const taker = await prisma.user.findUnique({
        where: { id: takerId },
        select: { discordId: true },
      });
      if (taker?.discordId) {
        await enqueueDiscordDM(
          "ORDER_FILLED",
          {
            contractId,
            contractTitle,
            side,
            totalFilled: result.totalFilled,
            fills: result.fills.map((f) => ({ size: f.size, strike: f.strike })),
          },
          taker.discordId,
          { dedupeKey: `dm-fill:${result.fills[0].tradeId}` }
        );
      }
    } catch {
      /* Discord DM is best-effort — never break the trade path. */
    }
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
