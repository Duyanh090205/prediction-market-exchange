-- Direct messages: a recipient turns a (contractId null) message into a 1-1 DM.

ALTER TABLE "Message" ADD COLUMN "recipientId" INTEGER;

CREATE INDEX "Message_recipientId_idx" ON "Message"("recipientId");

ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
