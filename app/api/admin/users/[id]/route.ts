import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { logAdminAction, extractClientIp } from "@/lib/audit";

const DEFAULT_STARTING_BALANCE = 1000;

// PATCH /api/admin/users/[id]
//   { action: "approve", balance?: number }   — APPROVE pending user, grant balance, write INITIAL_SEED ledger
//   { action: "deny" }                         — Hard-delete a PENDING user
//   { action: "suspend" }                     — ACTIVE → SUSPENDED
//   { action: "reactivate" }                  — SUSPENDED → ACTIVE
//   { action: "adjust_balance", delta: number, reason: string }
//   { action: "set_role", role: "USER" | "LIQUIDITY_PROVIDER" | "ADMIN" }
//
// All actions are admin-only, audited, and atomic.
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
    if (user.role !== "ADMIN") {
      reqLog.finish(403, user.id);
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { id } = await params;
    const userId = Number(id);
    if (isNaN(userId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const adminId = Number(user.id);
    const ip = extractClientIp(request);
    const body = await request.json();
    const { action } = body;

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, status: true, role: true, balance: true },
    });
    if (!target) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (action === "approve") {
      if (target.status !== "PENDING") {
        reqLog.finish(409, user.id);
        return NextResponse.json(
          { error: `User is already ${target.status}` },
          { status: 409 }
        );
      }

      const startingBalance = body.balance != null ? Number(body.balance) : DEFAULT_STARTING_BALANCE;
      if (!Number.isInteger(startingBalance) || startingBalance < 0) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: "balance must be a non-negative integer" },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            status: "ACTIVE",
            balance: startingBalance,
            approvedAt: new Date(),
            approvedBy: adminId,
          },
        });
        await tx.balanceLedger.create({
          data: {
            userId,
            delta: startingBalance,
            balanceAfter: startingBalance,
            eventType: "INITIAL_SEED",
            initiatedBy: adminId,
            note: `Approved registration — granted ${startingBalance} starting balance`,
          },
        });
        await tx.notification.create({
          data: {
            userId,
            message: `Your account has been approved. Starting balance: ${startingBalance} coins.`,
          },
        });
        await logAdminAction(
          {
            adminId,
            action: "APPROVE_USER",
            targetType: "User",
            targetUserId: userId,
            ipAddress: ip,
            metadata: { startingBalance },
            note: `Approved ${target.username} (${target.email})`,
          },
          tx
        );
      });

      reqLog.finish(200, user.id, { outcome: `approved-${userId}` });
      return NextResponse.json({ success: true });
    }

    if (action === "deny") {
      if (target.status !== "PENDING") {
        reqLog.finish(409, user.id);
        return NextResponse.json(
          { error: "Only PENDING users can be denied — use suspend for active users" },
          { status: 409 }
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: userId } });
        await logAdminAction(
          {
            adminId,
            action: "DENY_USER",
            targetType: "User",
            targetUserId: userId,
            ipAddress: ip,
            metadata: { username: target.username, email: target.email },
            note: `Denied registration ${target.username} (${target.email})`,
          },
          tx
        );
      });

      reqLog.finish(200, user.id, { outcome: `denied-${userId}` });
      return NextResponse.json({ success: true });
    }

    if (action === "suspend") {
      if (target.status !== "ACTIVE") {
        reqLog.finish(409, user.id);
        return NextResponse.json({ error: "User is not ACTIVE" }, { status: 409 });
      }
      if (target.role === "ADMIN") {
        reqLog.finish(403, user.id);
        return NextResponse.json({ error: "Cannot suspend an admin" }, { status: 403 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
        await logAdminAction(
          {
            adminId,
            action: "SUSPEND_USER",
            targetType: "User",
            targetUserId: userId,
            ipAddress: ip,
            note: `Suspended ${target.username}`,
          },
          tx
        );
      });
      reqLog.finish(200, user.id);
      return NextResponse.json({ success: true });
    }

    if (action === "reactivate") {
      if (target.status !== "SUSPENDED") {
        reqLog.finish(409, user.id);
        return NextResponse.json({ error: "User is not SUSPENDED" }, { status: 409 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
        await logAdminAction(
          {
            adminId,
            action: "REACTIVATE_USER",
            targetType: "User",
            targetUserId: userId,
            ipAddress: ip,
            note: `Reactivated ${target.username}`,
          },
          tx
        );
      });
      reqLog.finish(200, user.id);
      return NextResponse.json({ success: true });
    }

    if (action === "adjust_balance") {
      const delta = Number(body.delta);
      const reason = String(body.reason ?? "").trim();
      if (!Number.isInteger(delta) || delta === 0) {
        reqLog.finish(400, user.id);
        return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 });
      }
      if (reason.length < 5) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: "reason is required (min 5 chars) — explains the manual adjustment" },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: delta } },
          select: { balance: true },
        });
        await tx.balanceLedger.create({
          data: {
            userId,
            delta,
            balanceAfter: updated.balance,
            eventType: "ADMIN_ADJUSTMENT",
            initiatedBy: adminId,
            note: reason,
          },
        });
        await tx.notification.create({
          data: {
            userId,
            message: `Admin balance adjustment: ${delta > 0 ? "+" : ""}${delta} coins. Reason: ${reason}`,
          },
        });
        await logAdminAction(
          {
            adminId,
            action: "ADJUST_BALANCE",
            targetType: "User",
            targetUserId: userId,
            ipAddress: ip,
            metadata: { delta, reason, balanceAfter: updated.balance },
            note: `Adjusted balance by ${delta}: ${reason}`,
          },
          tx
        );
      });

      reqLog.finish(200, user.id);
      return NextResponse.json({ success: true });
    }

    reqLog.finish(400, user.id);
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
