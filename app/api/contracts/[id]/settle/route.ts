import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { calculatePnl } from "@/lib/pnl";
import { emitContractSettled } from "@/lib/socket-events";
import { enqueueDiscordEvent, enqueueDiscordDM } from "@/lib/discord/outbox";
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
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const contractId = Number(id);
    if (isNaN(contractId)) {
      reqLog.finish(400, user.id);
      return NextResponse.json({ error: "Invalid contract id" }, { status: 400 });
    }

    const body = await request.json();
    const { settlementValue: requestedValue } = body;

    // Fetch band, ownership and the creator's locked result. lockedResult is
    // globally omitted (lib/prisma.ts) but an explicit select still returns
    // it — settlement is where the lock is enforced.
    const bandContract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { minPrice: true, maxPrice: true, createdById: true, lockedResult: true },
    });
    if (!bandContract) {
      reqLog.finish(404, user.id);
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    const isAdmin = user.role === "ADMIN";
    // Only an admin or the market's creator may settle it.
    if (!isAdmin && Number(user.id) !== bandContract.createdById) {
      reqLog.finish(403, user.id);
      return NextResponse.json(
        { error: "Only an admin or the market creator can settle this market" },
        { status: 403 }
      );
    }

    // Committed-result integrity: a creator settles at exactly the value they
    // locked at creation (settlementValue may be omitted — the lock is used).
    // Only admins may settle at a free value (corrections, legacy markets).
    let settlementValue: number;
    if (!isAdmin && bandContract.lockedResult != null) {
      if (requestedValue != null && !Number.isInteger(requestedValue)) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: "settlementValue must be an integer" },
          { status: 400 }
        );
      }
      if (requestedValue != null && requestedValue !== bandContract.lockedResult) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: "This market settles at the result you locked at creation" },
          { status: 400 }
        );
      }
      settlementValue = bandContract.lockedResult;
    } else {
      if (requestedValue == null || !Number.isInteger(requestedValue)) {
        reqLog.finish(400, user.id);
        return NextResponse.json(
          { error: "settlementValue must be an integer" },
          { status: 400 }
        );
      }
      settlementValue = requestedValue;
    }

    // Settlement value must fall inside the contract's price band — otherwise
    // P&L is computed against an impossible outcome (e.g. 500 on a 0–100 band).
    if (
      settlementValue < bandContract.minPrice ||
      settlementValue > bandContract.maxPrice
    ) {
      reqLog.finish(400, user.id);
      return NextResponse.json(
        {
          error: `settlementValue must be within the price band ${bandContract.minPrice}–${bandContract.maxPrice}`,
        },
        { status: 400 }
      );
    }

    const adminId = Number(user.id);
    const ip = extractClientIp(request);
    const idempotencyKey = request.headers.get("Idempotency-Key")!;
    const reqBody = { contractId, settlementValue };

    try {
      const idemp = await checkIdempotency(adminId, "settle-contract", idempotencyKey, reqBody);
      if (idemp.cached) {
        reqLog.finish(200, user.id);
        return idemp.response;
      }
    } catch (e) {
      if (e instanceof IdempotencyMismatchError) {
        reqLog.finish(422, user.id);
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
      // Per-user net P&L across all their trades on this contract — one DM each.
      const pnlByUser: Record<number, number> = {};
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
        pnlByUser[trade.takerId] = (pnlByUser[trade.takerId] ?? 0) + takerPnl;
        pnlByUser[trade.makerId] = (pnlByUser[trade.makerId] ?? 0) + makerPnl;
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

      return { affectedUserIds: [...affectedUserIds], tradeCount: contract.trades.length, title: contract.title, pnlByUser };
    });

    await storeIdempotency(adminId, "settle-contract", idempotencyKey, reqBody, {
      success: true,
      settlementValue,
      tradesSettled: result.tradeCount,
    }, 200);

    // Emit WebSocket event for real-time UI updates
    emitContractSettled({ contractId, settlementValue });

    // Mirror the settlement to the Discord channel feed.
    await enqueueDiscordEvent(
      "CONTRACT_SETTLED",
      {
        contractId,
        contractTitle: result.title,
        settlementValue,
        tradesSettled: result.tradeCount,
      },
      { dedupeKey: `contract-settled:${contractId}` }
    );

    // Personal settlement DM to each affected user who has linked Discord —
    // one DM per user carrying their net P&L on this contract. Best-effort:
    // a Discord/DB hiccup here must never fail an already-committed settlement.
    try {
      const settleUserIds = Object.keys(result.pnlByUser).map(Number);
      if (settleUserIds.length > 0) {
        const linked = await prisma.user.findMany({
          where: { id: { in: settleUserIds }, discordId: { not: null } },
          select: { id: true, discordId: true },
        });
        for (const u of linked) {
          await enqueueDiscordDM(
            "SETTLEMENT_RESULT",
            { contractId, contractTitle: result.title, settlementValue, pnl: result.pnlByUser[u.id] ?? 0 },
            u.discordId!,
            { dedupeKey: `dm-settle:${contractId}:${u.id}` }
          );
        }
      }
    } catch {
      /* Discord DM is best-effort — never break the settlement response. */
    }

    reqLog.finish(200, user.id, { contractId, outcome: `settled-${settlementValue}` });
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
