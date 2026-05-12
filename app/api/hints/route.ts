import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

// POST /api/hints — LIQUIDITY_PROVIDER and ADMIN only
export async function POST(request: NextRequest) {
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

    const role = user.role;
    if (role !== "LIQUIDITY_PROVIDER" && role !== "ADMIN") {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only Market Maker or Admin can post hints" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { contractId, content, linkUrl, linkLabel } = body;

    if (!contractId || !content || typeof content !== "string" || content.trim().length === 0) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "contractId and content are required" },
        { status: 400 }
      );
    }

    // Verify contract exists and is OPEN
    const contract = await prisma.contract.findUnique({
      where: { id: Number(contractId) },
      select: { id: true, status: true },
    });

    if (!contract) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (contract.status !== "OPEN") {
      reqLog.finish(409, user.id);
      return NextResponse.json(
        { error: "Cannot add hints to a settled contract" },
        { status: 409 }
      );
    }

    const hint = await prisma.hint.create({
      data: {
        contractId: Number(contractId),
        authorId: Number(user.id),
        content: content.trim(),
        linkUrl: linkUrl ? String(linkUrl).trim() : null,
        linkLabel: linkLabel ? String(linkLabel).trim() : null,
      },
      include: {
        author: { select: { id: true, username: true, role: true } },
      },
    });

    reqLog.finish(201, user.id, { contractId: hint.contractId });
    return NextResponse.json({ hint }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
