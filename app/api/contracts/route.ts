import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

// GET /api/contracts — all OPEN contracts with quotes (including maker role)
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  try {
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        _count: {
          select: { trades: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    reqLog.finish(200, session.user.id);
    return NextResponse.json({ contracts });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/contracts — Admin only
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "ADMIN") {
      reqLog.finish(403, session.user.id);
      return NextResponse.json(
        { error: "Only Admin can create contracts" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { title, description } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }
    if (
      !description ||
      typeof description !== "string" ||
      description.trim().length === 0
    ) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    const contract = await prisma.contract.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        status: "OPEN",
      },
    });

    reqLog.finish(201, session.user.id, { contractId: contract.id });
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
