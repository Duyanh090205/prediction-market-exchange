import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { logAdminAction, extractClientIp } from "@/lib/audit";

// GET /api/contracts/[id] — full contract detail
// Returns: OPEN quotes (with maker info + pending request count), hints (newest first), OPEN trades
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
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/contracts/[id] — admin only, OPEN contracts only.
// Forbidden if any trades exist (preserves position history). Use settle instead.
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
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { id } = await params;
    const contractId = Number(id);
    if (isNaN(contractId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
    }

    const adminId = Number(user.id);
    const ip = extractClientIp(request);

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, title: true, status: true, _count: { select: { trades: true } } },
    });

    if (!contract) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (contract.status !== "OPEN") {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Cannot delete a settled contract. P&L has already been applied." }, { status: 400 });
    }
    if (contract._count.trades > 0) {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Cannot delete a contract with executed trades. Settle it instead." },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.hint.deleteMany({ where: { contractId } });
      await tx.quote.deleteMany({ where: { contractId } });
      await tx.contract.delete({ where: { id: contractId } });
      await logAdminAction(
        {
          adminId,
          action: "DELETE_CONTRACT",
          targetType: "Contract",
          targetId: contractId,
          ipAddress: ip,
          note: `Deleted contract "${contract.title}" (no trades)`,
        },
        tx
      );
    });

    reqLog.finish(200, user.id, { contractId });
    return NextResponse.json({ success: true });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

