import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";

export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const body = await request.json();
    const { username, email, password } = body;

    // Validate presence
    if (!username || !email || !password) {
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Username, email, and password are required" },
        { status: 400 }
      );
    }

    // Validate types + constraints
    if (typeof username !== "string" || username.trim().length < 2) {
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Username must be at least 2 characters" },
        { status: 400 }
      );
    }
    if (typeof email !== "string" || !email.includes("@")) {
      reqLog.finish(400);
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 }
      );
    }
    if (typeof password !== "string" || password.length < 8) {
      reqLog.finish(400);
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check uniqueness in one query
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: cleanUsername }, { email: cleanEmail }],
      },
      select: { username: true, email: true },
    });

    if (existing) {
      const field =
        existing.username === cleanUsername ? "username" : "email";
      reqLog.finish(409);
      return NextResponse.json(
        { error: `That ${field} is already taken` },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user + ledger row in one transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: cleanUsername,
          email: cleanEmail,
          hashedPassword,
          balance: 1000,
          role: "USER",
        },
      });

      await tx.balanceLedger.create({
        data: {
          userId: newUser.id,
          delta: 1000,
          balanceAfter: 1000,
          eventType: "INITIAL_SEED",
          initiatedBy: 0,
          note: "Self-registration",
        },
      });

      return newUser;
    });

    reqLog.finish(201, user.id);
    return NextResponse.json(
      { message: "Account created successfully" },
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
