import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { calculateAvailableMargin } from "@/lib/margin";

// POST /api/quotes — USER or LIQUIDITY_PROVIDER only (Admin blocked)
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Admin cannot post quotes
    if (session.user.role === "ADMIN") {
      reqLog.finish(403, session.user.id);
      return NextResponse.json(
        { error: "Admin cannot post quotes" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { contractId, bid, ask, size } = body;
    const isLP = session.user.role === "LIQUIDITY_PROVIDER";

    if (contractId == null || size == null) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "contractId and size are required" },
        { status: 400 }
      );
    }

    // LPs must post both sides (they're market makers)
    if (isLP && (bid == null || ask == null)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "Market makers must post both bid and ask" },
        { status: 400 }
      );
    }

    // Everyone else: at least one side required
    if (bid == null && ask == null) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "Must provide at least a bid or an ask" },
        { status: 400 }
      );
    }

    if (bid != null && !Number.isInteger(bid)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "bid must be an integer" }, { status: 400 });
    }
    if (ask != null && !Number.isInteger(ask)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "ask must be an integer" }, { status: 400 });
    }
    if (!Number.isInteger(size)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "size must be an integer" }, { status: 400 });
    }

    if (bid != null && ask != null && bid >= ask) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "bid must be strictly less than ask" },
        { status: 400 }
      );
    }

    if (size < 1) {
      reqLog.finish(400, session.user.id);
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
      reqLog.finish(404, session.user.id);
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }
    if (contract.status !== "OPEN") {
      reqLog.finish(409, session.user.id);
      return NextResponse.json(
        { error: "Cannot post quotes on a settled contract" },
        { status: 409 }
      );
    }
    if (bid != null && (bid < contract.minPrice || bid > contract.maxPrice)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: `bid must be in [${contract.minPrice}, ${contract.maxPrice}]` },
        { status: 400 }
      );
    }
    if (ask != null && (ask < contract.minPrice || ask > contract.maxPrice)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: `ask must be in [${contract.minPrice}, ${contract.maxPrice}]` },
        { status: 400 }
      );
    }

    // Worst-case for the maker if their full quote size were taken on the
    // adverse side: -size (per binary spread bet semantics). Reject the post
    // if the maker doesn't have margin to back what they're advertising.
    const makerId = Number(session.user.id);
    const available = await calculateAvailableMargin(makerId);
    if (available < size) {
      reqLog.finish(422, session.user.id);
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
        makerId,
        bid: bid ?? null,
        ask: ask ?? null,
        size,
        status: "OPEN",
      },
      include: {
        maker: { select: { id: true, username: true, role: true } },
      },
    });

    reqLog.finish(201, session.user.id, { contractId: quote.contractId });
    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
