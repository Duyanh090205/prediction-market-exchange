import { NextResponse } from "next/server";
import { cleanupIdempotencyKeys } from "@/lib/idempotency";

// GET /api/cron/idempotency — delete IdempotencyKeys older than 24h
export async function GET(request: Request) {
  const secret = request.headers.get("Authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await cleanupIdempotencyKeys();
  return NextResponse.json({ deleted });
}
