import { NextResponse } from "next/server";
import { reapExpiredDemoAccounts } from "@/lib/demoAccounts";

// GET /api/cron/demo-accounts — expire demo sandbox accounts past their TTL.
//
// POST /api/demo/session already runs this sweep on every mint, which is enough
// to bound the table: it only grows when someone mints. This route exists so the
// sweep can also be driven on a schedule, the same way the idempotency and
// notification cleanups are.
export async function GET(request: Request) {
  const secret = request.headers.get("Authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await reapExpiredDemoAccounts();
  return NextResponse.json(result);
}
