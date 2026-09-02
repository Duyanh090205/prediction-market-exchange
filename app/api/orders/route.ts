import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { validateIdempotencyHeader } from "@/lib/idempotency";
import { placeOrder } from "@/lib/orderService";
import {
  checkDemoOrderRateLimit,
  recordDemoOrder,
} from "@/lib/rate-limiter";

// POST /api/orders — Matching Engine (instant execution), cookie-authenticated.
// Thin adapter: cookie auth + CSRF + idempotency-header validation, then the
// shared placeOrder() core (also used by the Bearer-authenticated /api/v1/orders).
//
// The trading logic — LIMIT/MARKET matching, Double Margining, Price-Time
// Priority FIFO, slippage protection, idempotency, socket emits — lives in
// lib/orderService.ts.
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  // ── CSRF Guard (cookie-auth only) ──
  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  // ── Idempotency header (prevent duplicate writes on retry) ──
  const idempotencyError = validateIdempotencyHeader(request);
  if (idempotencyError) {
    reqLog.finish(idempotencyError.status);
    return idempotencyError;
  }

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Real accounts belong to people the operator invited and are bounded by
    // margin alone. A demo account is public, so it gets a per-minute ceiling
    // on top of that.
    if (user.isDemo) {
      const rl = await checkDemoOrderRateLimit(user.id);
      if (!rl.allowed) {
        const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 60_000) / 1000);
        reqLog.finish(429, user.id);
        return NextResponse.json(
          { error: "Demo accounts are limited to 30 orders per minute" },
          { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
        );
      }
      await recordDemoOrder(user.id);
    }

    const body = await request.json();
    const idempotencyKey = request.headers.get("Idempotency-Key")!;

    const res = await placeOrder({
      actorId: Number(user.id),
      userRole: user.role,
      body,
      idempotencyKey,
    });

    reqLog.finish(res.status, user.id);
    return res;
  } catch (error) {
    reqLog.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
