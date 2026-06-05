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

  const { contractId, bid, ask, size } = body;
  const isLP = userRole === "LIQUIDITY_PROVIDER";

  if (contractId == null || size == null) {
    return NextResponse.json(
      { error: "contractId and size are required" },
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
  if (!Number.isInteger(size)) {
    return NextResponse.json({ error: "size must be an integer" }, { status: 400 });
  }

  if (bid != null && ask != null && bid >= ask) {
    return NextResponse.json(
      { error: "bid must be strictly less than ask" },
      { status: 400 }
    );
  }

  if (size < 1) {
    return NextResponse.json(
      { error: "size must be at least 1" },
      { status: 400 }
    );
  }

  // Verify contract exists, is OPEN, and bid/ask fall inside its price band.
  const contract = await prisma.contract.findUnique({
    where: { id: Number(contractId) },
    select: { id: true, status: true, minPrice: true, maxPrice: true },
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

  // Worst-case for the maker if their full quote size were taken on the
  // adverse side: -size (per binary spread bet semantics). Reject the post
  // if the maker doesn't have margin to back what they're advertising.
  const available = await calculateAvailableMargin(actorId);
  if (available < size) {
    return NextResponse.json(
      {
        error: `Insufficient margin to back this quote: available ${available}, required ${size}`,
      },
      { status: 422 }
    );
  }

  const quote = await prisma.quote.create({
    data: {
      contractId: Number(contractId),
      makerId: actorId,
      bid: bid ?? null,
      ask: ask ?? null,
      size,
      status: "OPEN",
    },
    include: {
      maker: { select: { id: true, username: true, role: true } },
    },
  });

  // Append a price-chart point — a new quote can move the market mid.
  await recordPricePoint(quote.contractId);

  return NextResponse.json({ quote }, { status: 201 });
}
