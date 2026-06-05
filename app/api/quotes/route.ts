import { NextRequest, NextResponse } from "next/server";
import { getLabUser } from "@/lib/labAuth";
import { createRequestLogger } from "@/lib/logger";
import { csrfGuard } from "@/lib/csrf";
import { postQuote } from "@/lib/quoteService";

// POST /api/quotes — USER or LIQUIDITY_PROVIDER only (Admin blocked).
// Thin adapter: cookie auth + CSRF, then the shared postQuote() core (also used
// by the Bearer-authenticated /api/v1/quotes).
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const csrfError = csrfGuard(request);
  if (csrfError) {
    reqLog.finish(403);
    return csrfError;
  }

  try {
    const user = await getLabUser();
    if (!user) {
      reqLog.finish(401);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const res = await postQuote({
      actorId: Number(user.id),
      userRole: user.role,
      body,
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
