/**
 * Shared quote-posting core — the single source of truth for posting a quote,
 * used by BOTH the cookie route (app/api/quotes) and the bot route
 * (app/api/v1/quotes).
 *
 * Takes an already-authenticated actor + parsed body, returns a fully-formed
 * NextResponse (success or mapped error). Callers own only auth + transport.
 *
 * Extracted from app/api/quotes/route.ts with NO behavior change.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateAvailableMargin } from "@/lib/margin";
import { recordPricePoint } from "@/lib/price-history";
import { emitQuoteUpdated } from "@/lib/socket-events";
import { executeMarketOrder, type MatchResult } from "@/lib/matching-engine";
import { broadcastFills } from "@/lib/fill-effects";

export interface PostQuoteParams {
  actorId: number;
  userRole: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export async function postQuote({
  actorId,
  userRole,
  body,
}: PostQuoteParams): Promise<NextResponse> {
  // Admin cannot post quotes
  if (userRole === "ADMIN") {
    return NextResponse.json(
      { error: "Admin cannot post quotes" },
      { status: 403 }
    );
  }

  const { contractId, bid, ask } = body;
  const isLP = userRole === "LIQUIDITY_PROVIDER";

  // Per-side inventory. Backward-compat: a single legacy `size` applies to
  // whichever side(s) the maker is posting.
  let bidSize: number | null = body.bidSize != null ? Number(body.bidSize) : null;
  let askSize: number | null = body.askSize != null ? Number(body.askSize) : null;
  if (bidSize == null && askSize == null && body.size != null) {
    const legacy = Number(body.size);
    if (bid != null) bidSize = legacy;
    if (ask != null) askSize = legacy;
  }

  if (contractId == null) {
    return NextResponse.json(
      { error: "contractId is required" },
      { status: 400 }
    );
  }

  // LPs must post both sides (they're market makers)
  if (isLP && (bid == null || ask == null)) {
    return NextResponse.json(
      { error: "Market makers must post both bid and ask" },
      { status: 400 }
    );
  }

  // Everyone else: at least one side required
  if (bid == null && ask == null) {
    return NextResponse.json(
      { error: "Must provide at least a bid or an ask" },
      { status: 400 }
    );
  }

  if (bid != null && !Number.isInteger(bid)) {
    return NextResponse.json({ error: "bid must be an integer" }, { status: 400 });
  }
  if (ask != null && !Number.isInteger(ask)) {
    return NextResponse.json({ error: "ask must be an integer" }, { status: 400 });
  }

  // Each posted side needs its own positive-integer size.
  if (bid != null && (bidSize == null || !Number.isInteger(bidSize) || bidSize < 1)) {
    return NextResponse.json(
      { error: "bid size must be an integer >= 1" },
      { status: 400 }
    );
  }
  if (ask != null && (askSize == null || !Number.isInteger(askSize) || askSize < 1)) {
    return NextResponse.json(
      { error: "ask size must be an integer >= 1" },
      { status: 400 }
    );
  }

  if (bid != null && ask != null && bid >= ask) {
    return NextResponse.json(
      { error: "bid must be strictly less than ask" },
      { status: 400 }
    );
  }

  // Verify contract exists, is OPEN, and bid/ask fall inside its price band.
  const contract = await prisma.contract.findUnique({
    where: { id: Number(contractId) },
    select: { id: true, title: true, status: true, minPrice: true, maxPrice: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (contract.status !== "OPEN") {
    return NextResponse.json(
      { error: "Cannot post quotes on a settled contract" },
      { status: 409 }
    );
  }
  if (bid != null && (bid < contract.minPrice || bid > contract.maxPrice)) {
    return NextResponse.json(
      { error: `bid must be in [${contract.minPrice}, ${contract.maxPrice}]` },
      { status: 400 }
    );
  }
  if (ask != null && (ask < contract.minPrice || ask > contract.maxPrice)) {
    return NextResponse.json(
      { error: `ask must be in [${contract.minPrice}, ${contract.maxPrice}]` },
      { status: 400 }
    );
  }

  // Worst-case for the maker is being fully hit on whichever side is larger
  // (-max(bidSize, askSize) per binary spread bet semantics — the two sides
  // partially hedge if both are hit). Reject if the maker can't back it.
  const reserve = Math.max(
    bid != null ? (bidSize as number) : 0,
    ask != null ? (askSize as number) : 0
  );
  const available = await calculateAvailableMargin(actorId);
  if (available < reserve) {
    return NextResponse.json(
      {
        error: `Insufficient margin to back this quote: available ${available}, required ${reserve}`,
      },
      { status: 422 }
    );
  }

  // ── Crossing auto-match — the book never stays crossed ──
  // A quote's bid is an intent to take OVER at that price; its ask an intent to
  // take UNDER. If either side crosses resting orders, it executes immediately
  // at the RESTING orders' prices (first-submitted price honored), and only the
  // remainder rests in the book. Both sweeps + the insert are one transaction.
  const cid = Number(contractId);
  const empty: MatchResult = { fills: [], totalFilled: 0, cancelledQuoteIds: [] };

  const { bidResult, askResult, createdQuote } = await prisma.$transaction(
    async (tx) => {
      let bidResult: MatchResult = empty;
      let askResult: MatchResult = empty;

      if (bid != null) {
        // New bid B vs resting asks ≤ B → poster takes OVER at the resting ask.
        bidResult = await executeMarketOrder(tx, actorId, {
          contractId: cid,
          side: "OVER",
          size: bidSize as number,
          type: "MARKET",
          limitPrice: bid,
        });
      }
      if (ask != null) {
        // New ask A vs resting bids ≥ A → poster takes UNDER at the resting bid.
        askResult = await executeMarketOrder(tx, actorId, {
          contractId: cid,
          side: "UNDER",
          size: askSize as number,
          type: "MARKET",
          limitPrice: ask,
        });
      }

      let remBid = bid != null ? (bidSize as number) - bidResult.totalFilled : null;
      let remAsk = ask != null ? (askSize as number) - askResult.totalFilled : null;

      // Re-check margin AFTER the fills (they changed the maker's position) and
      // cap what can rest to what the maker can still back.
      const availableNow = await calculateAvailableMargin(actorId, tx);
      const restCap = Math.max(availableNow, 0);
      if (remBid != null) remBid = Math.min(remBid, restCap);
      if (remAsk != null) remAsk = Math.min(remAsk, restCap);

      let createdQuote = null;
      if ((remBid ?? 0) > 0 || (remAsk ?? 0) > 0) {
        createdQuote = await tx.quote.create({
          data: {
            contractId: cid,
            makerId: actorId,
            bid: bid ?? null,
            ask: ask ?? null,
            bidSize: bid != null ? remBid : null,
            askSize: ask != null ? remAsk : null,
            status: "OPEN",
          },
          include: {
            maker: { select: { id: true, username: true, role: true } },
          },
        });
      }

      return { bidResult, askResult, createdQuote };
    },
    { maxWait: 5000, timeout: 10000 }
  );

  // ── Side effects (post-commit): notifications + websocket pushes ──
  if (bidResult.fills.length || bidResult.cancelledQuoteIds.length) {
    await broadcastFills({
      takerId: actorId,
      contractId: cid,
      contractTitle: contract.title,
      side: "OVER",
      result: bidResult,
    });
  }
  if (askResult.fills.length || askResult.cancelledQuoteIds.length) {
    await broadcastFills({
      takerId: actorId,
      contractId: cid,
      contractTitle: contract.title,
      side: "UNDER",
      result: askResult,
    });
  }
  if (createdQuote) {
    emitQuoteUpdated({
      quoteId: createdQuote.id,
      contractId: cid,
      bidSize: createdQuote.bidSize,
      askSize: createdQuote.askSize,
      status: "OPEN",
    });
  }

  // Append a price-chart point — fills and/or the new quote can move the mid.
  await recordPricePoint(cid);

  const totalFilled = bidResult.totalFilled + askResult.totalFilled;
  return NextResponse.json(
    {
      quote: createdQuote,
      matched: {
        totalFilled,
        bidFilled: bidResult.totalFilled,
        askFilled: askResult.totalFilled,
        fills: [...bidResult.fills, ...askResult.fills],
      },
    },
    { status: 201 }
  );
}
