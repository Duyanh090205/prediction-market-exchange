-- Seed provenance moves out of reader-facing text and into its own column.
-- scripts/seed-demo.mjs used to append `<!-- __demo_seed_v2 -->` to
-- Contract.description so a rerun could detect its own dataset. React escapes
-- that comment, so it rendered as literal text under the title of every seeded
-- market, on the home page and on each market page.
ALTER TABLE "Contract" ADD COLUMN "isDemoSeed" BOOLEAN NOT NULL DEFAULT false;

-- Carry the existing rows over: set the flag, then strip the marker from the
-- text. Idempotent — re-running matches nothing once the text is clean.
UPDATE "Contract"
SET "isDemoSeed" = true,
    "description" = btrim(
      regexp_replace("description", '\s*<!--\s*__demo_seed_v[0-9]+\s*-->\s*', '', 'g')
    )
WHERE "description" LIKE '%__demo_seed_v%';

-- Sandbox accounts minted by "Enter as demo trader" on the public deployment.
-- They are ordinary USER rows; the flag is what denies them API-key minting
-- and bounds how many can accumulate.
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "User_isDemo_createdAt_idx" ON "User"("isDemo", "createdAt");
