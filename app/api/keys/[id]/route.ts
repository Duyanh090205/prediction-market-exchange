import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

// DELETE /api/keys/[id] — revoke one of the caller's keys (soft delete:
// sets revokedAt so getApiUser rejects it immediately). Keeps the row for
// audit/lastUsed history. Idempotent: revoking an already-revoked key is a no-op.
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
    const keyId = Number(id);
    if (isNaN(keyId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
    }

    const key = await prisma.apiKey.findUnique({
      where: { id: keyId },
      select: { id: true, userId: true, revokedAt: true },
    });

    // 404 (not 403) when it belongs to someone else, so we don't leak existence.
    if (!key || key.userId !== Number(user.id)) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    if (!key.revokedAt) {
      await prisma.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
      });
    }

    reqLog.finish(200, user.id, { apiKeyId: keyId });
    return NextResponse.json({ success: true });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
