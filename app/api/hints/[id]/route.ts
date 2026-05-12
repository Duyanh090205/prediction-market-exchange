import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

// PATCH /api/hints/[id] — author only
export async function PATCH(
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

    const { id } = await params;
    const hintId = Number(id);
    if (isNaN(hintId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid hint ID" }, { status: 400 });
    }

    const hint = await prisma.hint.findUnique({ where: { id: hintId } });

    if (!hint) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Hint not found" }, { status: 404 });
    }

    if (hint.authorId !== Number(user.id)) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only the author can edit this hint" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { content, linkUrl, linkLabel } = body;

    if (content !== undefined && (typeof content !== "string" || content.trim().length === 0)) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        { error: "Content cannot be empty" },
        { status: 400 }
      );
    }

    const updated = await prisma.hint.update({
      where: { id: hintId },
      data: {
        ...(content !== undefined && { content: content.trim() }),
        // Allow explicitly setting linkUrl/linkLabel to null to remove them
        ...(linkUrl !== undefined && { linkUrl: linkUrl ? String(linkUrl).trim() : null }),
        ...(linkLabel !== undefined && { linkLabel: linkLabel ? String(linkLabel).trim() : null }),
      },
      include: {
        author: { select: { id: true, username: true, role: true } },
      },
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ hint: updated });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/hints/[id] — author only
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

    const { id } = await params;
    const hintId = Number(id);
    if (isNaN(hintId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid hint ID" }, { status: 400 });
    }

    const hint = await prisma.hint.findUnique({ where: { id: hintId } });

    if (!hint) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Hint not found" }, { status: 404 });
    }

    const isAuthor = hint.authorId === Number(user.id);
    const isAdmin = user.role === "ADMIN";
    if (!isAuthor && !isAdmin) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only the author or an admin can delete this hint" },
        { status: 403 }
      );
    }

    await prisma.hint.delete({ where: { id: hintId } });

    reqLog.finish(200, user.id);
    return NextResponse.json({ message: "Hint deleted" });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
