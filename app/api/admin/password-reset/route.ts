import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { createHash, randomBytes } from "crypto";
import { SignJWT } from "jose";

function getTokenSecret() {
  const secret = process.env.RESET_TOKEN_SECRET;
  if (!secret) throw new Error("RESET_TOKEN_SECRET not set");
  return new TextEncoder().encode(secret);
}

// POST /api/admin/password-reset — Admin generates a reset token for a user
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
    if (user.role !== "ADMIN") {
      reqLog.finish(403, user.id);
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId || !Number.isInteger(Number(userId))) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: Number(userId) },
      select: { id: true, username: true },
    });
    if (!targetUser) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const adminId = Number(user.id);
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.$transaction([
      prisma.passwordResetToken.create({
        data: {
          userId: targetUser.id,
          tokenHash,
          expiresAt,
          createdBy: adminId,
        },
      }),
      prisma.adminAuditLog.create({
        data: {
          adminId,
          action: "GENERATE_RESET_TOKEN",
          targetUserId: targetUser.id,
          note: `Generated password reset token for ${targetUser.username}`,
        },
      }),
    ]);

    // Sign a JWT containing the raw token (so the URL is shorter than 64-char hex)
    const jwt = await new SignJWT({ token: rawToken, userId: targetUser.id })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(getTokenSecret());

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const resetLink = `${baseUrl}/reset-password?token=${jwt}`;

    reqLog.finish(201, user.id, { outcome: `reset-token-for-${targetUser.id}` });
    return NextResponse.json({ resetLink }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
