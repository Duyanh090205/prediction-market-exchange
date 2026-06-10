-- Optional clickable destination for a notification (e.g. a DM thread).

ALTER TABLE "Notification" ADD COLUMN "linkUrl" TEXT;
