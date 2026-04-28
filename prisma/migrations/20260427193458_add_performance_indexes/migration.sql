-- CreateIndex
CREATE INDEX "Quote_contractId_status_idx" ON "Quote"("contractId", "status");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");
