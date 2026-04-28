import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { calculateAvailableMargin } from "@/lib/margin";

// GET /api/users/me — current user's balance, margin info, open trade count
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  try {
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);

    const [user, openTradeCount, availableMargin] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, balance: true, role: true },
      }),
      prisma.trade.count({ where: { status: "OPEN", OR: [{ takerId: userId }, { makerId: userId }] } }),
      calculateAvailableMargin(userId),
    ]);

    if (!user) {
      reqLog.finish(404);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const marginInUse = user.balance - availableMargin;

    reqLog.finish(200, session.user.id);
    return NextResponse.json({
      id: user.id,
      username: user.username,
      balance: user.balance,
      availableMargin,
      marginInUse,
      openTradeCount,
    });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
