import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// GET /api/admin/users — list all users (Admin only)
export async function GET(request: NextRequest) {
  const reqLog = createRequestLogger(request);

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

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        balance: true,
        createdAt: true,
        approvedAt: true,
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });

    reqLog.finish(200, user.id);
    return NextResponse.json({ users });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/admin/users — create new user account (Admin only)
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
    const { username, email, role, balance } = body;

    if (!username || typeof username !== "string" || username.trim().length < 2) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "username must be at least 2 characters" }, { status: 400 });
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (!["ADMIN", "LIQUIDITY_PROVIDER", "USER"].includes(role)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const startingBalance = balance != null ? Number(balance) : 1000;
    if (!Number.isInteger(startingBalance) || startingBalance < 0) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "balance must be a non-negative integer" }, { status: 400 });
    }

    // Generate a temporary password
    const tempPassword = randomBytes(6).toString("hex"); // 12 hex chars
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const adminId = Number(user.id);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: username.trim(),
          email: email.trim().toLowerCase(),
          hashedPassword,
          role,
          balance: startingBalance,
          status: "ACTIVE",
          approvedAt: new Date(),
          approvedBy: adminId,
        },
        select: { id: true, username: true, email: true, role: true, balance: true, status: true },
      });

      await tx.balanceLedger.create({
        data: {
          userId: created.id,
          delta: startingBalance,
          balanceAfter: startingBalance,
          eventType: "INITIAL_SEED",
          initiatedBy: adminId,
          note: `Account created by admin`,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "CREATE_USER",
          targetType: "User",
          targetUserId: created.id,
          metadata: { role, startingBalance },
          note: `Created user ${created.username} (${role}) with balance ${startingBalance}`,
        },
      });

      return created;
    });

    reqLog.finish(201, user.id, { outcome: `created-user-${user.id}` });
    return NextResponse.json({ user, tempPassword }, { status: 201 });
  } catch (error) {
    reqLog.error(error);
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Username or email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
