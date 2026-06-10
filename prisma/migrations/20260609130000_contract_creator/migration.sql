-- Track who created each market (their primary market maker + can settle).

ALTER TABLE "Contract" ADD COLUMN "createdById" INTEGER;

CREATE INDEX "Contract_createdById_idx" ON "Contract"("createdById");

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
