import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { calculateAvailableMargin } from "@/lib/margin";
import { logAdminAction, extractClientIp } from "@/lib/audit";

// PATCH /api/quotes/[id] — maker only.
// Re-checks price band and maker margin if size or strikes change.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const quoteId = Number(id);
    if (isNaN(quoteId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid quote ID" }, { status: 400 });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        contract: {
          select: { minPrice: true, maxPrice: true, status: true },
        },
      },
    });

    if (!quote) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.makerId !== Number(user.id)) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only the maker can edit this quote" },
        { status: 403 }
      );
    }

    if (quote.status !== "OPEN") {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Cannot edit a quote that is not OPEN" },
        { status: 409 }
      );
    }

    if (quote.contract.status !== "OPEN") {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Contract is not open" },
        { status: 409 }
      );
    }

    const body = await request.json();
    const { bid, ask, size } = body;
    const isLP = user.role === "LIQUIDITY_PROVIDER";

    const bidProvided = Object.prototype.hasOwnProperty.call(body, "bid");
    const askProvided = Object.prototype.hasOwnProperty.call(body, "ask");

    const newBid: number | null = bidProvided ? (bid === null ? null : Number(bid)) : quote.bid;
    const newAsk: number | null = askProvided ? (ask === null ? null : Number(ask)) : quote.ask;
    const newSize = size != null ? Number(size) : quote.size;

    if (newBid != null && !Number.isInteger(newBid)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "bid must be an integer" }, { status: 400 });
    }
    if (newAsk != null && !Number.isInteger(newAsk)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "ask must be an integer" }, { status: 400 });
    }
    if (!Number.isInteger(newSize)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "size must be an integer" }, { status: 400 });
    }

    if (isLP && (newBid == null || newAsk == null)) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "Market makers must keep both bid and ask" },
        { status: 400 }
      );
    }

    if (newBid == null && newAsk == null) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "Quote must have at least a bid or an ask" },
        { status: 400 }
      );
    }

    if (newBid != null && newAsk != null && newBid >= newAsk) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "bid must be strictly less than ask" },
        { status: 400 }
      );
    }

    if (newSize < 1) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "size must be at least 1" },
        { status: 400 }
      );
    }

    const { minPrice, maxPrice } = quote.contract;
    if (newBid != null && (newBid < minPrice || newBid > maxPrice)) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: `bid must be in [${minPrice}, ${maxPrice}]` },
        { status: 400 }
      );
    }
    if (newAsk != null && (newAsk < minPrice || newAsk > maxPrice)) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: `ask must be in [${minPrice}, ${maxPrice}]` },
        { status: 400 }
      );
    }

    // Margin re-check when increasing size. The existing quote already
    // reserves `quote.size` units of headroom; adding `delta` requires that
    // many additional units of available margin.
    const sizeDelta = newSize - quote.size;
    if (sizeDelta > 0) {
      const available = await calculateAvailableMargin(quote.makerId);
      if (available < sizeDelta) {
        reqLog.finish(422, user.id);
        return NextResponse.json(
          {
            error: `Insufficient margin to grow quote: available ${available}, additional ${sizeDelta} required`,
          },
          { status: 422 }
        );
      }
    }

    const updated = await prisma.quote.update({
      where: { id: quoteId },
      data: { bid: newBid, ask: newAsk, size: newSize },
      include: {
        maker: { select: { id: true, username: true, role: true } },
      },
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ quote: updated });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/quotes/[id] — maker or admin. Cancels the quote.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const quoteId = Number(id);
    if (isNaN(quoteId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid quote ID" }, { status: 400 });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { contract: { select: { title: true } } },
    });

    if (!quote) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const actorId = Number(user.id);
    const isMaker = quote.makerId === actorId;
    const isAdmin = user.role === "ADMIN";
    if (!isMaker && !isAdmin) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only the maker or an admin can cancel this quote" },
        { status: 403 }
      );
    }

    if (quote.status !== "OPEN") {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Cannot cancel a quote that is not OPEN" },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quoteId },
        data: { status: "CANCELLED" },
      });

      if (!isMaker && isAdmin) {
        await tx.notification.create({
          data: {
            userId: quote.makerId,
            message: `Your quote on "${quote.contract.title}" was cancelled by an admin.`,
          },
        });
        await logAdminAction(
          {
            adminId: actorId,
            action: "CANCEL_QUOTE",
            targetType: "Quote",
            targetId: quoteId,
            targetUserId: quote.makerId,
            ipAddress: extractClientIp(request),
            note: `Cancelled quote on "${quote.contract.title}" (maker #${quote.makerId})`,
          },
          tx
        );
      }
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ message: "Quote cancelled" });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
