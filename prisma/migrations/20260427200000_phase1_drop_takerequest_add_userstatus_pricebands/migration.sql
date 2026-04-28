-- Phase 1: Drop take-request flow, add UserStatus, price bands, audit/idempotency upgrades
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop TakeRequest table + enum (no FK cascade since we hard-delete the path)
DROP TABLE IF EXISTS "TakeRequest";
DROP TYPE IF EXISTS "TakeRequestStatus";

-- 2. Add UserStatus enum + columns on User
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
  ADD COLUMN "status"     "UserStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" INTEGER;

-- Existing users (seed/admin/early adopters) are already ACTIVE
UPDATE "User" SET "status" = 'ACTIVE', "approvedAt" = "createdAt" WHERE "status" = 'PENDING';

-- New default for self-registered users is 0 balance until approved
ALTER TABLE "User" ALTER COLUMN "balance" SET DEFAULT 0;

CREATE INDEX "User_status_idx" ON "User"("status");

-- 3. Price bands on Contract
ALTER TABLE "Contract"
  ADD COLUMN "minPrice" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxPrice" INTEGER NOT NULL DEFAULT 100;

-- 4. EventType: replace TRADE_CONFIRM with ADMIN_ADJUSTMENT
-- Postgres can't drop enum values directly; rename, add new, migrate, drop old
ALTER TYPE "EventType" RENAME TO "EventType_old";
CREATE TYPE "EventType" AS ENUM ('INITIAL_SEED', 'SETTLEMENT', 'ADMIN_ADJUSTMENT');
ALTER TABLE "BalanceLedger"
  ALTER COLUMN "eventType" TYPE "EventType"
  USING (
    CASE "eventType"::text
      WHEN 'TRADE_CONFIRM' THEN 'ADMIN_ADJUSTMENT'::"EventType"
      ELSE "eventType"::text::"EventType"
    END
  );
DROP TYPE "EventType_old";

-- 5. BalanceLedger.initiatedBy → nullable (system events have no initiator)
ALTER TABLE "BalanceLedger" ALTER COLUMN "initiatedBy" DROP NOT NULL;
UPDATE "BalanceLedger" SET "initiatedBy" = NULL WHERE "initiatedBy" = 0;

CREATE INDEX "BalanceLedger_userId_createdAt_idx" ON "BalanceLedger"("userId", "createdAt");

-- 6. Trade: idempotency uniqueness + extra index
ALTER TABLE "Trade" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Trade_idempotencyKey_quoteId_key" ON "Trade"("idempotencyKey", "quoteId");
CREATE INDEX "Trade_contractId_status_idx" ON "Trade"("contractId", "status");

-- 7. NotificationArchive: enforce uniqueness
CREATE UNIQUE INDEX "NotificationArchive_originalId_key" ON "NotificationArchive"("originalId");

-- 8. AdminAuditLog: structured target + metadata
ALTER TABLE "AdminAuditLog"
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId"   INTEGER,
  ADD COLUMN "metadata"   JSONB,
  ADD COLUMN "ipAddress"  TEXT;

CREATE INDEX "AdminAuditLog_action_idx"            ON "AdminAuditLog"("action");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");
CREATE INDEX "AdminAuditLog_createdAt_idx"         ON "AdminAuditLog"("createdAt");
