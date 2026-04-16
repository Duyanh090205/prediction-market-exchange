import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

// PATCH /api/quotes/[id] — maker only, blocked if PENDING take requests exist
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
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const quoteId = Number(id);
    if (isNaN(quoteId)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "Invalid quote ID" }, { status: 400 });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        takeRequests: {
          where: { status: "PENDING" },
          select: { id: true },
        },
      },
    });

    if (!quote) {
      reqLog.finish(404, session.user.id);
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.makerId !== Number(session.user.id)) {
      reqLog.finish(403, session.user.id);
      return NextResponse.json(
        { error: "Only the maker can edit this quote" },
        { status: 403 }
      );
    }

    if (quote.status !== "OPEN") {
      reqLog.finish(409, session.user.id);
      return NextResponse.json(
        { error: "Cannot edit a quote that is not OPEN" },
        { status: 409 }
      );
    }

    if (quote.takeRequests.length > 0) {
      reqLog.finish(409, session.user.id);
      return NextResponse.json(
        { error: "Resolve all pending requests before editing." },
        { status: 409 }
      );
    }

    const body = await request.json();
    const { bid, ask, size } = body;

    // Determine new values (fall back to current if not provided)
    const newBid = bid != null ? Number(bid) : quote.bid;
    const newAsk = ask != null ? Number(ask) : quote.ask;
    const newSize = size != null ? Number(size) : quote.size;

    if (!Number.isInteger(newBid) || !Number.isInteger(newAsk) || !Number.isInteger(newSize)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "bid, ask, and size must be integers" },
        { status: 400 }
      );
    }

    if (newBid >= newAsk) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "bid must be strictly less than ask" },
        { status: 400 }
      );
    }

    if (newSize < 1) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "size must be at least 1" },
        { status: 400 }
      );
    }

    const updated = await prisma.quote.update({
      where: { id: quoteId },
      data: { bid: newBid, ask: newAsk, size: newSize },
      include: {
        maker: { select: { id: true, username: true, role: true } },
      },
    });

    reqLog.finish(200, session.user.id);
    return NextResponse.json({ quote: updated });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/quotes/[id] — maker only
// Rejects all PENDING take requests, notifies requesters, cancels quote
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
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const quoteId = Number(id);
    if (isNaN(quoteId)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "Invalid quote ID" }, { status: 400 });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        takeRequests: {
          where: { status: "PENDING" },
          select: { id: true, requesterId: true },
        },
        contract: { select: { title: true } },
      },
    });

    if (!quote) {
      reqLog.finish(404, session.user.id);
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.makerId !== Number(session.user.id)) {
      reqLog.finish(403, session.user.id);
      return NextResponse.json(
        { error: "Only the maker can delete this quote" },
        { status: 403 }
      );
    }

    if (quote.status !== "OPEN") {
      reqLog.finish(409, session.user.id);
      return NextResponse.json(
        { error: "Cannot delete a quote that is not OPEN" },
        { status: 409 }
      );
    }

    // Transaction: reject pending requests → notify requesters → cancel quote
    await prisma.$transaction(async (tx) => {
      if (quote.takeRequests.length > 0) {
        const pendingIds = quote.takeRequests.map((r) => r.id);

        // Reject all pending take requests
        await tx.takeRequest.updateMany({
          where: { id: { in: pendingIds } },
          data: { status: "REJECTED" },
        });

        // Notify each requester
        const notifications = quote.takeRequests.map((r) => ({
          userId: r.requesterId,
          message: `Your take request on a quote for "${quote.contract.title}" was rejected because the quote was cancelled.`,
        }));
        await tx.notification.createMany({ data: notifications });
      }

      // Cancel the quote
      await tx.quote.update({
        where: { id: quoteId },
        data: { status: "CANCELLED" },
      });
    });

    reqLog.finish(200, session.user.id);
    return NextResponse.json({ message: "Quote cancelled" });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
