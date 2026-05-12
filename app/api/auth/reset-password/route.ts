import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { createHash } from "crypto";
import { jwtVerify } from "jose";
import bcrypt from "bcryptjs";

function getTokenSecret() {
  const secret = process.env.RESET_TOKEN_SECRET;
  if (!secret) throw new Error("RESET_TOKEN_SECRET not set");
  return new TextEncoder().encode(secret);
}

// POST /api/auth/reset-password — validate token, set new password
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const body = await request.json();
    const { token, password } = body;

    if (!token || !password) {
      reqLog.finish(400);
      return NextResponse.json({ error: "token and password required" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8) {
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Verify JWT
    let payload: { token: string; userId: number };
    try {
      const { payload: p } = await jwtVerify(token, getTokenSecret());
      payload = p as { token: string; userId: number };
    } catch {
      reqLog.finish(422);
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 422 });
    }

    const rawToken = payload.token;
    const userId = payload.userId;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    // Find token record
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!resetToken) {
      reqLog.finish(422);
      return NextResponse.json(
        { error: "Invalid, expired, or already used reset token" },
        { status: 422 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      prisma.adminAuditLog.create({
        data: {
          adminId: resetToken.createdBy,
          action: "PASSWORD_RESET",
          targetUserId: userId,
          note: `Password reset completed for user #${userId}`,
        },
      }),
    ]);

    reqLog.finish(200, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
