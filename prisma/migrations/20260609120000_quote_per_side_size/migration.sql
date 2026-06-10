-- Split Quote.size into independent per-side inventory (bidSize / askSize).
-- Hitting the ask now only decrements askSize; the bid is untouched.

ALTER TABLE "Quote" ADD COLUMN "bidSize" INTEGER;
ALTER TABLE "Quote" ADD COLUMN "askSize" INTEGER;

-- Backfill: the old single `size` applied to whichever side(s) were priced.
UPDATE "Quote" SET "bidSize" = "size" WHERE "bid" IS NOT NULL;
UPDATE "Quote" SET "askSize" = "size" WHERE "ask" IS NOT NULL;

ALTER TABLE "Quote" DROP COLUMN "size";
