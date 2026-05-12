import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";

// GET /api/admin/audit-log?limit=100&action=DELETE_TRADE&targetType=Trade
//
// Returns the most recent admin actions, newest first.
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "ADMIN") {
      reqLog.finish(403, user.id);
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
    const action = url.searchParams.get("action") ?? undefined;
    const targetType = url.searchParams.get("targetType") ?? undefined;
    const targetId = url.searchParams.get("targetId");

    const entries = await prisma.adminAuditLog.findMany({
      where: {
        action: action || undefined,
        targetType: targetType || undefined,
        targetId: targetId ? Number(targetId) : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ entries });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
