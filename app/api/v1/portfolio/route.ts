import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { requireApiUser } from "@/lib/apiGuard";
import { SCOPE_READ } from "@/lib/apiAuth";
import { calculateAvailableMargin } from "@/lib/margin";

// GET /api/v1/portfolio — the bot's account snapshot: balance, margin, and open
// positions. Combines the data behind GET /api/users/me and the Positions page.
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const auth = await requireApiUser(request, SCOPE_READ);
  if (!auth.ok) {
    reqLog.finish(auth.response.status);
    return auth.response;
  }
  const { user } = auth;

  try {
    const userId = Number(user.id);

    const [dbUser, openTrades, availableMargin] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, balance: true, role: true },
      }),
      prisma.trade.findMany({
        where: { status: "OPEN", OR: [{ takerId: userId }, { makerId: userId }] },
        include: { contract: { select: { id: true, title: true } } },
        orderBy: { createdAt: "desc" },
      }),
      calculateAvailableMargin(userId),
    ]);

    if (!dbUser) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const marginInUse = dbUser.balance - availableMargin;

    // Normalise each open trade to THIS user's perspective: the side they hold
    // (maker holds the opposite of takerSide) and a plain win/loss summary.
    const positions = openTrades.map((t) => {
      const isAsTaker = t.takerId === userId;
      const side: "OVER" | "UNDER" = isAsTaker
        ? (t.takerSide as "OVER" | "UNDER")
        : t.takerSide === "OVER"
          ? "UNDER"
          : "OVER";
      return {
        tradeId: t.id,
        contractId: t.contract.id,
        contractTitle: t.contract.title,
        side,
        strike: t.strike,
        size: t.size,
        role: isAsTaker ? "taker" : "maker",
      };
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      balance: dbUser.balance,
      availableMargin,
      marginInUse,
      openTradeCount: positions.length,
      positions,
    });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
