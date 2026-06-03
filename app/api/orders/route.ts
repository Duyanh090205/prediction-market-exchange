import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { calculateAvailableMargin } from "@/lib/margin";
import {
  validateIdempotencyHeader,
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

// POST /api/orders — Matching Engine (instant execution)
// Replaces the manual take-request → confirm flow.
// Supports LIMIT (hit a specific quote) and MARKET (sweep the book).
//
// Implements:
//   - Double Margining (Submission + Execution checks)
//   - Price-Time Priority FIFO (Hyperliquid CLOB concept)
//   - Slippage Protection via Marketable Limit Orders
//   - Option A toxic quote cancellation
//
// Skills applied:
//   - nextjs-expert: Route Handler pattern, auth check, CSRF guard
//   - prisma-expert: Interactive $transaction with maxWait/timeout
//   - websocket-engineer: (events emitted here, consumed by server.js)

export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  // ── CSRF Guard (nextjs-expert: protect state-changing routes) ──
  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  // ── Idempotency (prisma-expert: prevent duplicate writes) ──
  const idempotencyError = validateIdempotencyHeader(request);
  if (idempotencyError) {
    reqLog.finish(idempotencyError.status);
    return idempotencyError;
  }

  try {
    // ── Auth Check (nextjs-expert: server-side session validation) ──
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.role === "ADMIN") {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Admin cannot submit orders" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { contractId, side, size, type, quoteId, limitPrice } = body;

    // ── Input Validation ──
    if (contractId == null || side == null || size == null || type == null) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "contractId, side, size, and type are required" },
        { status: 400 }
      );
    }

    if (type !== "LIMIT" && type !== "MARKET") {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "type must be LIMIT or MARKET" },
        { status: 400 }
      );
    }

    if (side !== "OVER" && side !== "UNDER") {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "side must be OVER or UNDER" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(size) || size < 1) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "size must be an integer >= 1" },
        { status: 400 }
      );
    }

    // S2: max size is capped by margin (dynamic per user), but add a
    // hard sanity ceiling to prevent absurd values
    if (size > 10000) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "size cannot exceed 10000" },
        { status: 400 }
      );
    }

    if (type === "LIMIT" && quoteId == null) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "LIMIT orders require a quoteId" },
        { status: 400 }
      );
    }

    if (type === "MARKET" && limitPrice == null) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "MARKET orders require a limitPrice for slippage protection" },
        { status: 400 }
      );
    }

    if (limitPrice != null && !Number.isInteger(limitPrice)) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "limitPrice must be an integer" },
        { status: 400 }
      );
    }

    const actorId = Number(user.id);
    const idempotencyKey = request.headers.get("Idempotency-Key")!;

    // ── Idempotency Check ──
    try {
      const idempResult = await checkIdempotency(
        actorId,
        "order",
        idempotencyKey,
        body
      );
      if (idempResult.cached) {
        reqLog.finish(200, user.id);
        return idempResult.response;
      }
    } catch (e) {
      if (e instanceof IdempotencyMismatchError) {
        reqLog.finish(422, user.id);
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
      reqLog.finish(404, user.id);
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }
    if (contract.status !== "OPEN") {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Contract is not open" },
        { status: 409 }
      );
    }

    if (
      limitPrice != null &&
      (limitPrice < contract.minPrice || limitPrice > contract.maxPrice)
    ) {
      reqLog.finish(400, user.id);
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
      reqLog.finish(422, user.id);
      return NextResponse.json(
        {
          error: `Insufficient margin: you have ${takerMargin} available`,
        },
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
    // prisma-expert: use maxWait + timeout for transaction safety
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
        reqLog.finish(409, user.id);
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      if (e instanceof SelfTradeError) {
        reqLog.finish(409, user.id);
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      if (e instanceof SideNotOfferedError) {
        reqLog.finish(400, user.id);
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      if (e instanceof MakerMarginError) {
        reqLog.finish(422, user.id);
        return NextResponse.json(
          { error: e.message, cancelledQuoteId: e.quoteId },
          { status: 422 }
        );
      }
      if (e instanceof ContractMismatchError) {
        reqLog.finish(400, user.id);
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      if (e instanceof TakerMarginError) {
        reqLog.finish(422, user.id);
        return NextResponse.json({ error: e.message }, { status: 422 });
      }
      throw e; // Unknown error → fall through to 500
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
    // websocket-engineer: emit to per-user and per-contract rooms
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

    reqLog.finish(statusCode, user.id, {
      contractId: contract.id,
      outcome: `filled-${result.totalFilled}-of-${orderInput.size}`,
    });

    return NextResponse.json(responseBody, { status: statusCode });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
