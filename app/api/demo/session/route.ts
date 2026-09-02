import { NextRequest, NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { extractClientIp } from "@/lib/audit";
import {
  checkDemoSessionRateLimit,
  recordDemoSessionAttempt,
} from "@/lib/rate-limiter";
import {
  DEMO_LIVE_CAP,
  countLiveDemoAccounts,
  demoLandingPath,
  mintDemoAccount,
  reapExpiredDemoAccounts,
} from "@/lib/demoAccounts";

// POST /api/demo/session — mint a throwaway sandbox account and return its
// credentials so the browser can sign in with them through the ordinary
// NextAuth credentials provider.
//
// Unauthenticated by necessity: it is what a reviewer with no account clicks.
// Guarded by CSRF (same-origin only), a per-IP budget, a live-account cap, and
// a 24h TTL enforced here on the way in — see lib/demoAccounts.ts.
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  const ip = extractClientIp(request);
  const rl = await checkDemoSessionRateLimit(ip);
  if (!rl.allowed) {
    reqLog.finish(429);
    return NextResponse.json(
      {
        error:
          "Too many demo sessions from this address. Try again in an hour, or sign in with an account.",
      },
      { status: 429 }
    );
  }
  await recordDemoSessionAttempt(ip);

  try {
    // Expiring on the way in means the table is trimmed by the traffic that
    // grows it, with no scheduler required. /api/cron/demo-accounts runs the
    // same sweep for deployments that would rather not wait for a visitor.
    await reapExpiredDemoAccounts();

    const live = await countLiveDemoAccounts();
    if (live >= DEMO_LIVE_CAP) {
      reqLog.finish(503);
      return NextResponse.json(
        {
          error:
            "All demo accounts are in use right now. They expire within 24 hours — please try again later.",
        },
        { status: 503 }
      );
    }

    const account = await mintDemoAccount();
    const redirectTo = await demoLandingPath();

    reqLog.finish(201);
    return NextResponse.json(
      {
        username: account.username,
        email: account.email,
        password: account.password,
        redirectTo,
      },
      { status: 201 }
    );
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
