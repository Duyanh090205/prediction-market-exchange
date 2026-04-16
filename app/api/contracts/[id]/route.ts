import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";

// GET /api/contracts/[id] — full contract detail
// Returns: OPEN quotes (with maker info + pending request count), hints (newest first), OPEN trades
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqLog = createRequestLogger(request);

  try {
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const contractId = Number(id);
    if (isNaN(contractId)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        quotes: {
          where: { status: "OPEN" },
          include: {
            maker: { select: { id: true, username: true, role: true } },
            takeRequests: {
              where: { status: "PENDING" },
              select: { id: true },
            },
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
      reqLog.finish(404, session.user.id);
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    reqLog.finish(200, session.user.id, { contractId });
    return NextResponse.json({ contract });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
