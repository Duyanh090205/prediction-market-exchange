import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { requireApiUser } from "@/lib/apiGuard";
import { SCOPE_READ } from "@/lib/apiAuth";

// GET /api/v1/contracts — open markets with their live order book (OPEN quotes).
// Bearer-authenticated analog of GET /api/contracts.
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const auth = await requireApiUser(request, SCOPE_READ);
  if (!auth.ok) {
    reqLog.finish(auth.response.status);
    return auth.response;
  }
  const { user } = auth;

  try {
    const contracts = await prisma.contract.findMany({
      where: { status: "OPEN" },
      include: {
        quotes: {
          where: { status: "OPEN" },
          include: {
            maker: { select: { id: true, username: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { trades: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ contracts });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
