import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

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

    // Validate all required fields
    if (contractId == null || bid == null || ask == null || size == null) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "contractId, bid, ask, and size are required" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(bid) || !Number.isInteger(ask) || !Number.isInteger(size)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "bid, ask, and size must be integers" },
        { status: 400 }
      );
    }

    if (bid >= ask) {
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

    // Verify contract exists and is OPEN
    const contract = await prisma.contract.findUnique({
      where: { id: Number(contractId) },
      select: { id: true, status: true },
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

    const quote = await prisma.quote.create({
      data: {
        contractId: Number(contractId),
        makerId: Number(session.user.id),
        bid,
        ask,
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
