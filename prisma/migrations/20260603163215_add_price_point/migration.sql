-- CreateTable
CREATE TABLE "PricePoint" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mid" DOUBLE PRECISION NOT NULL,
    "lastTrade" INTEGER,
    "bestBid" INTEGER,
    "bestAsk" INTEGER,

    CONSTRAINT "PricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricePoint_contractId_ts_idx" ON "PricePoint"("contractId", "ts");

-- AddForeignKey
ALTER TABLE "PricePoint" ADD CONSTRAINT "PricePoint_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
