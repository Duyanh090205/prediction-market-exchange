/**
 * Shared order-placement core — the single source of truth for placing a
 * LIMIT/MARKET order, used by BOTH the cookie route (app/api/orders) and the
 * bot route (app/api/v1/orders).
 *
 * It takes an already-authenticated actor + the parsed body + a validated
 * Idempotency-Key and returns a fully-formed NextResponse (success or mapped
 * error). The callers own only the auth + transport concerns (cookie CSRF vs
 * Bearer scope, request logging); all trading logic — validation, margin,
 * matching, idempotency, notifications, socket emits, price points — lives here.
 *
 * This was extracted from app/api/orders/route.ts with NO behavior change.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateAvailableMargin } from "@/lib/margin";
import {
  checkIdempotency,
  storeIdempotency,
  IdempotencyMismatchError,
} from "@/lib/idempotency";
import {
  executeMarketOrder,
  type OrderInput,
  type MatchResult,
} from "@/lib/matching-engine";
import { broadcastFills } from "@/lib/fill-effects";
import { emitQuoteUpdated } from "@/lib/socket-events";
import { recordPricePoint } from "@/lib/price-history";

export interface PlaceOrderParams {
  actorId: number;
  userRole: string;
  // The parsed JSON request body (caller-supplied; same object used for the
  // idempotency hash so retries with a different payload are rejected).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** A validated Idempotency-Key (UUIDv7) — callers validate the header format. */
  idempotencyKey: string;
}

/**
 * Place an order. Returns a NextResponse the caller forwards verbatim.
 * Throws only on truly unexpected errors (caller maps those to 500).
 */
export async function placeOrder({
  actorId,
  body,
  idempotencyKey,
}: PlaceOrderParams): Promise<NextResponse> {
  const { contractId, side, size, type, limitPrice } = body;

  // ── Input Validation ──
  if (contractId == null || side == null || size == null || type == null) {
    return NextResponse.json(
      { error: "contractId, side, size, and type are required" },
      { status: 400 }
    );
  }

  if (type !== "LIMIT" && type !== "MARKET") {
    return NextResponse.json(
      { error: "type must be LIMIT or MARKET" },
      { status: 400 }
    );
  }

  if (side !== "OVER" && side !== "UNDER") {
    return NextResponse.json(
      { error: "side must be OVER or UNDER" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(size) || size < 1) {
    return NextResponse.json(
      { error: "size must be an integer >= 1" },
      { status: 400 }
    );
  }

  // S2: max size is capped by margin (dynamic per user), but add a
  // hard sanity ceiling to prevent absurd values
  if (size > 10000) {
    return NextResponse.json(
      { error: "size cannot exceed 10000" },
      { status: 400 }
    );
  }

  // Targeting a specific quote was removed — only MARKET (fill at best price)
  // and LIMIT (fill up to a price; remainder rests in the book) exist now.
  if (body.quoteId != null) {
    return NextResponse.json(
      { error: "quoteId targeting was removed — use a LIMIT order with limitPrice" },
      { status: 400 }
    );
  }

  if (type === "LIMIT" && limitPrice == null) {
    return NextResponse.json(
      { error: "LIMIT orders require a limitPrice" },
      { status: 400 }
    );
  }

  if (limitPrice != null && !Number.isInteger(limitPrice)) {
    return NextResponse.json(
      { error: "limitPrice must be an integer" },
      { status: 400 }
    );
  }

  // ── Idempotency Check ──
  try {
    const idempResult = await checkIdempotency(
      actorId,
      "order",
      idempotencyKey,
      body
    );
    if (idempResult.cached) {
      return idempResult.response;
    }
  } catch (e) {
    if (e instanceof IdempotencyMismatchError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }

  // ── Verify contract is OPEN and price band ──
  const contract = await prisma.contract.findUnique({
    where: { id: Number(contractId) },
    select: { id: true, title: true, status: true, minPrice: true, maxPrice: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (contract.status !== "OPEN") {
    return NextResponse.json({ error: "Contract is not open" }, { status: 409 });
  }

  if (
    limitPrice != null &&
    (limitPrice < contract.minPrice || limitPrice > contract.maxPrice)
  ) {
    return NextResponse.json(
      {
        error: `limitPrice must be in [${contract.minPrice}, ${contract.maxPrice}]`,
      },
      { status: 400 }
    );
  }

  // ── Submission margin pre-check (cheap fail-fast outside the txn) ──
  const takerMargin = await calculateAvailableMargin(actorId);
  if (takerMargin <= 0) {
    return NextResponse.json(
      { error: `Insufficient margin: you have ${takerMargin} available` },
      { status: 422 }
    );
  }

  // ── Build order input ──
  // The sweep cap: a LIMIT order's price, or the band edge for MARKET (fill at
  // whatever the book offers — there is no resting price for a market order).
  const cap =
    limitPrice != null
      ? Number(limitPrice)
      : side === "OVER"
        ? contract.maxPrice
        : contract.minPrice;

  const orderInput: OrderInput = {
    contractId: Number(contractId),
    side: side as "OVER" | "UNDER",
    size,
    type: type as "LIMIT" | "MARKET",
    limitPrice: cap,
    idempotencyKey,
  };

  // ── Execute inside Prisma interactive transaction ──
  // Sweep first (always enabled — any matching resting orders execute, at the
  // resting order's price). For LIMIT, the unfilled remainder then RESTS in the
  // book as a one-sided quote at the limit price:
  //   buy OVER  @ ≤P, remainder R → bid P ×R (an UNDER seller hits it at P)
  //   buy UNDER @ ≥P, remainder R → ask P ×R (an OVER buyer hits it at P)
  let resting: { quoteId: number; price: number; size: number } | null = null;

  const result: MatchResult = await prisma.$transaction(
    async (tx) => {
      const r = await executeMarketOrder(tx, actorId, orderInput);

      if (type === "LIMIT") {
        const remainder = size - r.totalFilled;
        if (remainder > 0) {
          // Reserve margin for the resting side; cap to what the taker can
          // actually back after the fills above.
          const available = await calculateAvailableMargin(actorId, tx);
          const restSize = Math.min(remainder, Math.max(available, 0));
          if (restSize > 0) {
            const q = await tx.quote.create({
              data:
                side === "OVER"
                  ? { contractId: orderInput.contractId, makerId: actorId, bid: cap, bidSize: restSize, status: "OPEN" }
                  : { contractId: orderInput.contractId, makerId: actorId, ask: cap, askSize: restSize, status: "OPEN" },
            });
            resting = { quoteId: q.id, price: cap, size: restSize };
          }
        }
      }
      return r;
    },
    {
      maxWait: 5000, // Wait up to 5s for a transaction slot
      timeout: 10000, // Transaction must complete within 10s
    }
  );

  // ── Side effects: taker notification + websocket pushes ──
  await broadcastFills({
    takerId: actorId,
    contractId: orderInput.contractId,
    contractTitle: contract.title,
    side: orderInput.side,
    result,
  });
  if (resting) {
    const r = resting as { quoteId: number; price: number; size: number };
    emitQuoteUpdated({
      quoteId: r.quoteId,
      contractId: orderInput.contractId,
      bidSize: side === "OVER" ? r.size : null,
      askSize: side === "UNDER" ? r.size : null,
      status: "OPEN",
    });
  }

  // Append a price-chart point if the fill/resting order moved the market mid.
  await recordPricePoint(orderInput.contractId);

  const responseBody: Record<string, unknown> = {
    type: orderInput.type,
    side: orderInput.side,
    requestedSize: orderInput.size,
    totalFilled: result.totalFilled,
    fills: result.fills,
    cancelledQuoteIds: result.cancelledQuoteIds,
    resting,
  };

  // UX: flag when nothing happened at all (no fill AND nothing rested)
  if (result.totalFilled === 0 && !resting) {
    responseBody.warning =
      type === "LIMIT"
        ? "Nothing filled and insufficient margin to rest the order"
        : "No quotes matched your order criteria";
  }

  const statusCode = 200;
  await storeIdempotency(
    actorId,
    "order",
    idempotencyKey,
    body,
    responseBody,
    statusCode
  );

  return NextResponse.json(responseBody, { status: statusCode });
}
