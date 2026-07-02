import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { csrfGuard } from "@/lib/csrf";
import { createRequestLogger } from "@/lib/logger";

// POST /api/discord/unlink — remove the caller's Discord link.
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

    await prisma.user.update({
      where: { id: Number(user.id) },
      data: { discordId: null, discordUsername: null, discordLinkedAt: null },
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
