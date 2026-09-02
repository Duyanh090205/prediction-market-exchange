import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { emitContractCreated } from "@/lib/socket-events";
import { enqueueDiscordEvent } from "@/lib/discord/outbox";

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

// POST /api/contracts — any authenticated user can create their own market.
// The creator becomes its primary market maker and may settle it.
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

    // Markets created here appear on the public home page and cannot be removed
    // by anyone but an admin. A throwaway account should not be able to put
    // text there.
    if (user.isDemo) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Demo accounts cannot create markets" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { title, description, minPrice, maxPrice, lockedResult } = body;

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

    // Integrity: the creator commits the settlement result up front and cannot
    // change it after seeing positions. Required for player-created markets;
    // admins may omit it (e.g. markets on future events settled from the real
    // outcome). Visible only to the creator (globally omitted in lib/prisma.ts).
    let locked: number | null = null;
    if (lockedResult != null && lockedResult !== "") {
      // Strict: only a JSON number is accepted. Coercing strings/booleans
      // (Number(" ") === 0, Number(true) === 1) could silently lock a value
      // the creator never entered.
      if (typeof lockedResult !== "number" || !Number.isInteger(lockedResult)) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: "lockedResult must be an integer" },
          { status: 400 }
        );
      }
      locked = lockedResult;
      if (locked < minP || locked > maxP) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: `lockedResult must be within the price band ${minP}–${maxP}` },
          { status: 400 }
        );
      }
    } else if (user.role !== "ADMIN") {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        {
          error:
            "lockedResult is required: enter the result your market will settle at. It is locked at creation and visible only to you.",
        },
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
        createdById: Number(user.id),
        lockedResult: locked,
      },
    });

    // Broadcast so every open markets list refreshes live (no manual reload).
    emitContractCreated({ contractId: contract.id, title: contract.title });

    // Announce the new market on the Discord channel feed.
    await enqueueDiscordEvent(
      "CONTRACT_CREATED",
      {
        contractId: contract.id,
        title: contract.title,
        description: contract.description,
        minPrice: contract.minPrice,
        maxPrice: contract.maxPrice,
        creatorName: user.username,
      },
      { dedupeKey: `contract-created:${contract.id}` }
    );

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
