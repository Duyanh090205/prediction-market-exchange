import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import {
  checkRegisterRateLimit,
  recordRegisterAttempt,
} from "@/lib/rate-limiter";
import { extractClientIp } from "@/lib/audit";

// POST /api/auth/register
//
// Creates a new account in PENDING status. The user cannot log in until an
// admin approves the account via /api/admin/users/[id]/approve. No starting
// balance is granted at this point — the INITIAL_SEED ledger entry is
// written atomically with approval.
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  const ip = extractClientIp(request);
  const rl = await checkRegisterRateLimit(ip);
  if (!rl.allowed) {
    reqLog.finish(429);
    return NextResponse.json(
      { error: "Too many registration attempts. Try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { username, email, password } = body;

    if (!username || !email || !password) {
      await recordRegisterAttempt(ip);
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Username, email, and password are required" },
        { status: 400 }
      );
    }

    if (typeof username !== "string" || username.trim().length < 2) {
      await recordRegisterAttempt(ip);
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Username must be at least 2 characters" },
        { status: 400 }
      );
    }
    if (typeof email !== "string" || !email.includes("@")) {
      await recordRegisterAttempt(ip);
      reqLog.finish(400);
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 }
      );
    }
    if (typeof password !== "string" || password.length < 8) {
      await recordRegisterAttempt(ip);
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: cleanUsername }, { email: cleanEmail }],
      },
      select: { username: true, email: true },
    });

    if (existing) {
      await recordRegisterAttempt(ip);
      const field =
        existing.username === cleanUsername ? "username" : "email";
      reqLog.finish(409);
      return NextResponse.json(
        { error: `That ${field} is already taken` },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: cleanEmail,
        hashedPassword,
        balance: 0,
        role: "USER",
        status: "PENDING",
      },
    });

    // Notify admins so approval queue surfaces immediately
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true },
    });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          message: `New registration pending approval: ${cleanUsername} (${cleanEmail})`,
        })),
      });
    }

    reqLog.finish(201, user.id);
    return NextResponse.json(
      {
        message: "Account created. An admin must approve before you can sign in.",
      },
      { status: 201 }
    );
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
