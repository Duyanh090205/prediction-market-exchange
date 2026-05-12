import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";

// GET /api/notifications — unread count + recent notifications for current user.
//
// Take-request flow has been removed (instant matching only) so we no longer
// surface pendingRequests here.
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(user.id);

    const [unreadCount, notifications] = await Promise.all([
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          message: true,
          isRead: true,
          createdAt: true,
        },
      }),
    ]);

    reqLog.finish(200, user.id);
    return NextResponse.json({ unreadCount, notifications });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
