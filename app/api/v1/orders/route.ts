import { NextRequest, NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";
import { requireApiUser } from "@/lib/apiGuard";
import { SCOPE_TRADE } from "@/lib/apiAuth";
import { validateIdempotencyHeader } from "@/lib/idempotency";
import { placeOrder } from "@/lib/orderService";

// POST /api/v1/orders — place a LIMIT/MARKET order with a Bearer API key.
// Bearer auth has no CSRF risk, so (unlike the cookie route) there is no CSRF
// guard. Bots must still send an Idempotency-Key (UUIDv7) so a retried request
// can't double-fill. All trading logic is the shared placeOrder() core.
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const auth = await requireApiUser(request, SCOPE_TRADE);
  if (!auth.ok) {
    reqLog.finish(auth.response.status);
    return auth.response;
  }
  const { user } = auth;

  // Idempotency-Key header is required (same contract as the cookie route).
  const idempotencyError = validateIdempotencyHeader(request);
  if (idempotencyError) {
    reqLog.finish(idempotencyError.status, user.id);
    return idempotencyError;
  }

  try {
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
