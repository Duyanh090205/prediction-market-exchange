import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { emitContractCreated } from "@/lib/socket-events";

// GET /api/contracts — all OPEN contracts with quotes (including maker role)
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const showAll = url.searchParams.get("all") === "1" && user.role === "ADMIN";

    const contracts = await prisma.contract.findMany({
      where: showAll ? {} : { status: "OPEN" },
      include: {
        quotes: {
          where: { status: "OPEN" },
          include: {
            maker: { select: { id: true, username: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { trades: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ contracts });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/contracts — Admin or Liquidity Provider
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.role !== "ADMIN" && user.role !== "LIQUIDITY_PROVIDER") {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only Admin or Liquidity Provider can create contracts" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { title, description, minPrice, maxPrice } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }
    if (
      !description ||
      typeof description !== "string" ||
      description.trim().length === 0
    ) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    const minP = minPrice != null ? Number(minPrice) : 0;
    const maxP = maxPrice != null ? Number(maxPrice) : 100;
    if (!Number.isInteger(minP) || !Number.isInteger(maxP)) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "minPrice and maxPrice must be integers" },
        { status: 400 }
      );
    }
    if (minP >= maxP) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "minPrice must be strictly less than maxPrice" },
        { status: 400 }
      );
    }

    const contract = await prisma.contract.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        minPrice: minP,
        maxPrice: maxP,
        status: "OPEN",
      },
    });

    // Broadcast so every open markets list refreshes live (no manual reload).
    emitContractCreated({ contractId: contract.id, title: contract.title });

    reqLog.finish(201, user.id, { contractId: contract.id });
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
