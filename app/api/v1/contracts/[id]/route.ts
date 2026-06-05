import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { requireApiUser } from "@/lib/apiGuard";
import { SCOPE_READ } from "@/lib/apiAuth";

// GET /api/v1/contracts/[id] — full market detail: OPEN quotes (order book),
// hints (newest first), OPEN trades. Bearer-authenticated analog of
// GET /api/contracts/[id].
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqLog = createRequestLogger(request);

  const auth = await requireApiUser(request, SCOPE_READ);
  if (!auth.ok) {
    reqLog.finish(auth.response.status);
    return auth.response;
  }
  const { user } = auth;

  try {
    const { id } = await params;
    const contractId = Number(id);
    if (isNaN(contractId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid contract id" }, { status: 400 });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        quotes: {
          where: { status: "OPEN" },
          include: {
            maker: { select: { id: true, username: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        hints: {
          include: {
            author: { select: { id: true, username: true, role: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        trades: {
          where: { status: "OPEN" },
          include: {
            taker: { select: { id: true, username: true } },
            maker: { select: { id: true, username: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!contract) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    reqLog.finish(200, user.id, { contractId });
    return NextResponse.json({ contract });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
