/**
 * Admin audit log — every destructive or trust-sensitive admin action
 * MUST go through this helper. Accepts an optional Prisma TransactionClient
 * so the audit row commits atomically with the action it records.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type PrismaLike = Prisma.TransactionClient | typeof prisma;

export type AdminAction =
  | "CREATE_USER"
  | "APPROVE_USER"
  | "DENY_USER"
  | "SUSPEND_USER"
  | "REACTIVATE_USER"
  | "ADJUST_BALANCE"
  | "GENERATE_RESET_TOKEN"
  | "PASSWORD_RESET"
  | "DELETE_CONTRACT"
  | "DELETE_QUOTE"
  | "DELETE_TRADE"
  | "SETTLE_CONTRACT"
  | "CANCEL_QUOTE";

export interface AuditEntry {
  adminId: number;
  action: AdminAction;
  targetType?: "User" | "Contract" | "Quote" | "Trade";
  targetId?: number;
  targetUserId?: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  note: string;
}

export async function logAdminAction(
  entry: AuditEntry,
  client?: PrismaLike
): Promise<void> {
  const db = client ?? prisma;
  await db.adminAuditLog.create({
    data: {
      adminId: entry.adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetUserId: entry.targetUserId,
      metadata: entry.metadata
        ? (entry.metadata as Prisma.InputJsonValue)
        : undefined,
      ipAddress: entry.ipAddress,
      note: entry.note,
    },
  });
}

export function extractClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
