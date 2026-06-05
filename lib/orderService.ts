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
  executeLimitOrder,
  executeMarketOrder,
  QuoteNotOpenError,
  SelfTradeError,
  SideNotOfferedError,
  MakerMarginError,
  ContractMismatchError,
  TakerMarginError,
  type OrderInput,
  type MatchResult,
} from "@/lib/matching-engine";
import { emitTradeExecuted, emitQuoteUpdated } from "@/lib/socket-events";
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
  userRole,
  body,
  idempotencyKey,
}: PlaceOrderParams): Promise<NextResponse> {
  if (userRole === "ADMIN") {
    return NextResponse.json(
      { error: "Admin cannot submit orders" },
      { status: 403 }
    );
  }

  const { contractId, side, size, type, quoteId, limitPrice } = body;

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

  if (type === "LIMIT" && quoteId == null) {
    return NextResponse.json(
      { error: "LIMIT orders require a quoteId" },
      { status: 400 }
    );
  }

  if (type === "MARKET" && limitPrice == null) {
    return NextResponse.json(
      { error: "MARKET orders require a limitPrice for slippage protection" },
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
  const orderInput: OrderInput = {
    contractId: Number(contractId),
    side: side as "OVER" | "UNDER",
    size,
    type: type as "LIMIT" | "MARKET",
    quoteId: quoteId != null ? Number(quoteId) : undefined,
    limitPrice: limitPrice != null ? Number(limitPrice) : undefined,
    idempotencyKey,
  };

  // ── Execute inside Prisma interactive transaction ──
  let result: MatchResult;

  try {
    result = await prisma.$transaction(
      async (tx) => {
        if (orderInput.type === "LIMIT") {
          return executeLimitOrder(tx, actorId, orderInput);
        } else {
          return executeMarketOrder(tx, actorId, orderInput);
        }
      },
      {
        maxWait: 5000, // Wait up to 5s for a transaction slot
        timeout: 10000, // Transaction must complete within 10s
      }
    );
  } catch (e) {
    // Handle known matching engine errors gracefully
    if (e instanceof QuoteNotOpenError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof SelfTradeError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof SideNotOfferedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof MakerMarginError) {
      return NextResponse.json(
        { error: e.message, cancelledQuoteId: e.quoteId },
        { status: 422 }
      );
    }
    if (e instanceof ContractMismatchError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof TakerMarginError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e; // Unknown error → caller maps to 500
  }

  // ── Notify taker of fills ──
  if (result.totalFilled > 0) {
    const fillSummary = result.fills
      .map((f) => `${f.size}@${f.strike}`)
      .join(", ");
    await prisma.notification.create({
      data: {
        userId: actorId,
        message: `Order filled: ${result.totalFilled} total (${fillSummary}) on "${contract.title}"`,
      },
    });
  }

  // ── WebSocket: push real-time updates ──
  for (const fill of result.fills) {
    emitTradeExecuted({
      tradeId: fill.tradeId,
      contractId: orderInput.contractId,
      quoteId: fill.quoteId,
      takerId: actorId,
      makerId: fill.makerId,
      takerSide: orderInput.side,
      strike: fill.strike,
      size: fill.size,
    });
  }

  // Notify about quote status changes (exhausted/decremented)
  for (const fill of result.fills) {
    emitQuoteUpdated({
      quoteId: fill.quoteId,
      contractId: orderInput.contractId,
      newSize: fill.quoteRemainingSize,
      status: fill.quoteStatus,
    });
  }
  for (const cancelledId of result.cancelledQuoteIds) {
    emitQuoteUpdated({
      quoteId: cancelledId,
      contractId: orderInput.contractId,
      newSize: 0,
      status: "CANCELLED",
    });
  }

  // Append a price-chart point if the fill moved the market mid.
  await recordPricePoint(orderInput.contractId);

  const responseBody: Record<string, unknown> = {
    type: orderInput.type,
    side: orderInput.side,
    requestedSize: orderInput.size,
    totalFilled: result.totalFilled,
    fills: result.fills,
    cancelledQuoteIds: result.cancelledQuoteIds,
  };

  // UX: flag zero-fill so the frontend can distinguish "no matches" from "filled"
  if (result.totalFilled === 0) {
    responseBody.warning = "No quotes matched your order criteria";
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
