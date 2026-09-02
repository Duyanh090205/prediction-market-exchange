-- A market with no settlement date reads as open ended. Real venues always
-- publish one, and a reviewer looking at four undated markets cannot tell
-- whether the book is stale or the contract simply has not expired yet.
ALTER TABLE "Contract" ADD COLUMN "settlesAt" TIMESTAMP(3);

-- When settlement actually happened. Set by the settle route so a settled
-- market can say when, without inferring it from updatedAt (which any later
-- write would move).
ALTER TABLE "Contract" ADD COLUMN "settledAt" TIMESTAMP(3);

-- Backfill: markets settled before this column existed. updatedAt is the best
-- available evidence for those rows and stops them rendering a blank date.
UPDATE "Contract" SET "settledAt" = "updatedAt" WHERE "status" = 'SETTLED';
