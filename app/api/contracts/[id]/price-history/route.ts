import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";

// GET /api/contracts/[id]/price-history — time series of the market mid for the
// live price chart. Returns points oldest→newest as { t (unix seconds), mid }.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqLog = createRequestLogger(request);
  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const contractId = Number(id);
    if (isNaN(contractId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid contract id" }, { status: 400 });
    }

    // Most recent 1000 points, returned chronologically for the chart.
    const rows = await prisma.pricePoint.findMany({
      where: { contractId },
      orderBy: { ts: "desc" },
      take: 1000,
      select: { ts: true, mid: true },
    });

    const points = rows
      .reverse()
      .map((p) => ({ t: Math.floor(p.ts.getTime() / 1000), mid: p.mid }));

    // Executed trades — plotted as dots at (time, strike) on top of the mid line.
    const tradeRows = await prisma.trade.findMany({
      where: { contractId },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { createdAt: true, strike: true },
    });
    const trades = tradeRows.map((t) => ({
      t: Math.floor(t.createdAt.getTime() / 1000),
      price: t.strike,
    }));

    reqLog.finish(200, user.id);
    return NextResponse.json({ points, trades });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
