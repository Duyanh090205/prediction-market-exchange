import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { calculatePnl } from "@/lib/pnl";
import { emitContractSettled } from "@/lib/socket-events";
import { logAdminAction, extractClientIp } from "@/lib/audit";
import {
  validateIdempotencyHeader,
  checkIdempotency,
  storeIdempotency,
  IdempotencyMismatchError,
} from "@/lib/idempotency";

// POST /api/contracts/[id]/settle — Admin only, all-or-nothing transaction
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  const idempotencyError = validateIdempotencyHeader(request);
  if (idempotencyError) {
    reqLog.finish(idempotencyError.status);
    return idempotencyError;
  }

  try {
    const session = await auth();
    if (!session?.user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "ADMIN") {
      reqLog.finish(403, session.user.id);
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { id } = await params;
    const contractId = Number(id);
    if (isNaN(contractId)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json({ error: "Invalid contract id" }, { status: 400 });
    }

    const body = await request.json();
    const { settlementValue } = body;

    if (settlementValue == null || !Number.isInteger(settlementValue)) {
      reqLog.finish(400, session.user.id);
      return NextResponse.json(
        { error: "settlementValue must be an integer" },
        { status: 400 }
      );
    }

    const adminId = Number(session.user.id);
    const ip = extractClientIp(request);
    const idempotencyKey = request.headers.get("Idempotency-Key")!;
    const reqBody = { contractId, settlementValue };

    try {
      const idemp = await checkIdempotency(adminId, "settle-contract", idempotencyKey, reqBody);
      if (idemp.cached) {
        reqLog.finish(200, session.user.id);
        return idemp.response;
      }
    } catch (e) {
      if (e instanceof IdempotencyMismatchError) {
        reqLog.finish(422, session.user.id);
        return NextResponse.json({ error: e.message }, { status: 422 });
      }
      throw e;
    }

    const result = await prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: {
          trades: {
            where: { status: "OPEN" },
            include: {
              taker: { select: { id: true, balance: true, username: true } },
              maker: { select: { id: true, balance: true, username: true } },
            },
          },
        },
      });

      if (!contract) throw new Error("Contract not found");
      if (contract.status !== "OPEN") throw new Error("Contract is already settled");

      // 1. Cancel all OPEN quotes
      await tx.quote.updateMany({
        where: { contractId, status: "OPEN" },
        data: { status: "CANCELLED" },
      });

      // 2. Settle all OPEN trades with P&L
      const affectedUserIds = new Set<number>();
      for (const trade of contract.trades) {
        const { takerPnl, makerPnl } = calculatePnl(
          trade.takerSide as "OVER" | "UNDER",
          trade.strike,
          settlementValue,
          trade.size
        );

        // Update trade
        await tx.trade.update({
          where: { id: trade.id },
          data: { status: "SETTLED", takerPnl, makerPnl },
        });

        // Taker balance update — use increment to avoid stale snapshot
        const updatedTaker = await tx.user.update({
          where: { id: trade.takerId },
          data: { balance: { increment: takerPnl } },
          select: { balance: true },
        });
        await tx.balanceLedger.create({
          data: {
            userId: trade.takerId,
            delta: takerPnl,
            balanceAfter: updatedTaker.balance,
            eventType: "SETTLEMENT",
            tradeId: trade.id,
            contractId,
            initiatedBy: adminId,
            note: `Settlement contract #${contractId} "${contract.title}", trade #${trade.id} — ${trade.taker.username} ${trade.takerSide} ${trade.strike} × ${trade.size}, result ${settlementValue}`,
          },
        });

        // Maker balance update — use increment to avoid stale snapshot
        const updatedMaker = await tx.user.update({
          where: { id: trade.makerId },
          data: { balance: { increment: makerPnl } },
          select: { balance: true },
        });
        await tx.balanceLedger.create({
          data: {
            userId: trade.makerId,
            delta: makerPnl,
            balanceAfter: updatedMaker.balance,
            eventType: "SETTLEMENT",
            tradeId: trade.id,
            contractId,
            initiatedBy: adminId,
            note: `Settlement contract #${contractId} "${contract.title}", trade #${trade.id} — ${trade.maker.username} maker side, result ${settlementValue}`,
          },
        });

        // Notify both parties
        const takerMsg =
          takerPnl > 0
            ? `You won +${takerPnl} on contract "${contract.title}" (${trade.takerSide} ${trade.strike} × ${trade.size}, result ${settlementValue})`
            : takerPnl < 0
            ? `You lost ${takerPnl} on contract "${contract.title}" (${trade.takerSide} ${trade.strike} × ${trade.size}, result ${settlementValue})`
            : `Push on contract "${contract.title}" — no coins exchanged`;

        await tx.notification.create({ data: { userId: trade.takerId, message: takerMsg } });
        await tx.notification.create({
          data: {
            userId: trade.makerId,
            message: `Settlement: contract "${contract.title}" trade #${trade.id}, result ${settlementValue}. Your P&L: ${makerPnl > 0 ? "+" : ""}${makerPnl}`,
          },
        });

        affectedUserIds.add(trade.takerId);
        affectedUserIds.add(trade.makerId);
      }

      // 3. Settle contract
      await tx.contract.update({
        where: { id: contractId },
        data: { status: "SETTLED", settlementValue },
      });

      // 4. Integrity check INSIDE the txn — every affected user's balance
      //    must equal SUM(delta) on their BalanceLedger. If not, abort
      //    the entire settlement so we never persist an inconsistent state.
      const mismatches: Array<{ userId: number; balance: number; ledgerSum: number }> = [];
      for (const uid of affectedUserIds) {
        const [u, agg] = await Promise.all([
          tx.user.findUnique({ where: { id: uid }, select: { balance: true } }),
          tx.balanceLedger.aggregate({ where: { userId: uid }, _sum: { delta: true } }),
        ]);
        if (!u) continue;
        const sum = agg._sum.delta ?? 0;
        if (u.balance !== sum) {
          mismatches.push({ userId: uid, balance: u.balance, ledgerSum: sum });
        }
      }
      if (mismatches.length > 0) {
        throw new BalanceIntegrityError(mismatches);
      }

      // 5. Audit
      await logAdminAction(
        {
          adminId,
          action: "SETTLE_CONTRACT",
          targetType: "Contract",
          targetId: contractId,
          ipAddress: ip,
          metadata: { settlementValue, tradesSettled: contract.trades.length },
          note: `Settled contract "${contract.title}" at ${settlementValue}`,
        },
        tx
      );

      return { affectedUserIds: [...affectedUserIds], tradeCount: contract.trades.length };
    });

    await storeIdempotency(adminId, "settle-contract", idempotencyKey, reqBody, {
      success: true,
      settlementValue,
      tradesSettled: result.tradeCount,
    }, 200);

    // Emit WebSocket event for real-time UI updates
    emitContractSettled({ contractId, settlementValue });

    reqLog.finish(200, session.user.id, { contractId, outcome: `settled-${settlementValue}` });
    return NextResponse.json({
      success: true,
      settlementValue,
      tradesSettled: result.tradeCount,
    });
  } catch (error) {
    if (error instanceof BalanceIntegrityError) {
      reqLog.error(error, undefined, { mismatches: error.mismatches });
      // Notify admins out-of-band so the issue surfaces even though the txn rolled back
      try {
        const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
        await Promise.all(
          admins.map((a) =>
            prisma.notification.create({
              data: {
                userId: a.id,
                message: `ALERT: Settlement aborted — balance integrity mismatch on contract. Mismatches: ${JSON.stringify(error.mismatches)}`,
              },
            })
          )
        );
      } catch {
        /* best effort */
      }
      return NextResponse.json(
        { error: "Settlement aborted: balance integrity mismatch", mismatches: error.mismatches },
        { status: 500 }
      );
    }
    reqLog.error(error);
    if (error instanceof Error) {
      if (error.message === "Contract not found")
        return NextResponse.json({ error: error.message }, { status: 404 });
      if (error.message === "Contract is already settled")
        return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

class BalanceIntegrityError extends Error {
  mismatches: Array<{ userId: number; balance: number; ledgerSum: number }>;
  constructor(mismatches: Array<{ userId: number; balance: number; ledgerSum: number }>) {
    super("Balance integrity mismatch");
    this.mismatches = mismatches;
  }
}
