import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { logAdminAction, extractClientIp } from "@/lib/audit";

// DELETE /api/trades/[id] — admin only, OPEN trades only
// Hard-deletes the trade; frees margin for both parties; notifies both.
// SETTLED trades cannot be deleted (balances already adjusted).
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

    if (user.role !== "ADMIN") {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only admins can delete trades" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const tradeId = Number(id);
    if (isNaN(tradeId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid trade ID" }, { status: 400 });
    }

    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: { contract: { select: { title: true } } },
    });

    if (!trade) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    if (trade.status !== "OPEN") {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Only OPEN trades can be deleted" },
        { status: 409 }
      );
    }

    const adminId = Number(user.id);
    const ip = extractClientIp(request);

    await prisma.$transaction(async (tx) => {
      await tx.trade.delete({ where: { id: tradeId } });
      await tx.notification.createMany({
        data: [
          {
            userId: trade.takerId,
            message: `Your trade on "${trade.contract.title}" (${trade.takerSide} ${trade.strike} × ${trade.size}) was deleted by an admin.`,
          },
          {
            userId: trade.makerId,
            message: `A trade on your quote for "${trade.contract.title}" (${trade.takerSide} ${trade.strike} × ${trade.size}) was deleted by an admin.`,
          },
        ],
      });
      await logAdminAction(
        {
          adminId,
          action: "DELETE_TRADE",
          targetType: "Trade",
          targetId: tradeId,
          ipAddress: ip,
          metadata: {
            contractId: trade.contractId,
            takerId: trade.takerId,
            makerId: trade.makerId,
            takerSide: trade.takerSide,
            strike: trade.strike,
            size: trade.size,
          },
          note: `Deleted trade #${tradeId} on "${trade.contract.title}"`,
        },
        tx
      );
    });

    reqLog.finish(200, user.id, { outcome: `trade-deleted-${tradeId}` });
    return NextResponse.json({ message: "Trade deleted" });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
