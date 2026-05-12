import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/cron/notifications — archive >90d, delete archive >180d
// Called by a cron job at midnight UTC daily.
// Secured by CRON_SECRET header to prevent unauthorized runs.
export async function GET(request: Request) {
  const secret = request.headers.get("Authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // Delete archived notifications older than 180 days
  const deleted = await prisma.notificationArchive.deleteMany({
    where: { originalCreatedAt: { lt: oneEightyDaysAgo } },
  });

  // Move notifications older than 90 days to archive
  const toArchive = await prisma.notification.findMany({
    where: { createdAt: { lt: ninetyDaysAgo } },
  });

  let archived = 0;
  if (toArchive.length > 0) {
    await prisma.notificationArchive.createMany({
      data: toArchive.map((n) => ({
        originalId: n.id,
        userId: n.userId,
        message: n.message,
        isRead: n.isRead,
        originalCreatedAt: n.createdAt,
      })),
      skipDuplicates: true,
    });
    await prisma.notification.deleteMany({
      where: { id: { in: toArchive.map((n) => n.id) } },
    });
    archived = toArchive.length;
  }

  return NextResponse.json({ archived, deleted: deleted.count });
}
