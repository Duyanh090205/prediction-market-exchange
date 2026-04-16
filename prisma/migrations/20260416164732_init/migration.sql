-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'LIQUIDITY_PROVIDER', 'USER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'EXHAUSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('OVER', 'UNDER');

-- CreateEnum
CREATE TYPE "TakeRequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('INITIAL_SEED', 'TRADE_CONFIRM', 'SETTLEMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 1000,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'OPEN',
    "settlementValue" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "makerId" INTEGER NOT NULL,
    "bid" INTEGER NOT NULL,
    "ask" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeRequest" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "side" "Side" NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "TakeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "takerId" INTEGER NOT NULL,
    "makerId" INTEGER NOT NULL,
    "takerSide" "Side" NOT NULL,
    "strike" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
    "takerPnl" INTEGER,
    "makerPnl" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hint" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "linkUrl" TEXT,
    "linkLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationArchive" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL,
    "originalCreatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceLedger" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "eventType" "EventType" NOT NULL,
    "tradeId" INTEGER,
    "contractId" INTEGER,
    "initiatedBy" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" INTEGER,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Quote_contractId_idx" ON "Quote"("contractId");

-- CreateIndex
CREATE INDEX "Quote_makerId_idx" ON "Quote"("makerId");

-- CreateIndex
CREATE INDEX "TakeRequest_quoteId_idx" ON "TakeRequest"("quoteId");

-- CreateIndex
CREATE INDEX "TakeRequest_requesterId_idx" ON "TakeRequest"("requesterId");

-- CreateIndex
CREATE INDEX "Trade_contractId_idx" ON "Trade"("contractId");

-- CreateIndex
CREATE INDEX "Trade_takerId_idx" ON "Trade"("takerId");

-- CreateIndex
CREATE INDEX "Trade_makerId_idx" ON "Trade"("makerId");

-- CreateIndex
CREATE INDEX "Hint_contractId_idx" ON "Hint"("contractId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "NotificationArchive_userId_idx" ON "NotificationArchive"("userId");

-- CreateIndex
CREATE INDEX "BalanceLedger_userId_idx" ON "BalanceLedger"("userId");

-- CreateIndex
CREATE INDEX "BalanceLedger_eventType_idx" ON "BalanceLedger"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_actorId_action_idempotencyKey_key" ON "IdempotencyKey"("actorId", "action", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog"("adminId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeRequest" ADD CONSTRAINT "TakeRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeRequest" ADD CONSTRAINT "TakeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_takerId_fkey" FOREIGN KEY ("takerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hint" ADD CONSTRAINT "Hint_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hint" ADD CONSTRAINT "Hint_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceLedger" ADD CONSTRAINT "BalanceLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
