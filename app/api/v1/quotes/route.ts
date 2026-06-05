import { NextRequest, NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";
import { requireApiUser } from "@/lib/apiGuard";
import { SCOPE_TRADE } from "@/lib/apiAuth";
import { postQuote } from "@/lib/quoteService";

// POST /api/v1/quotes — post a quote with a Bearer API key (no CSRF, see orders).
// USER or LIQUIDITY_PROVIDER only; Admin is blocked inside postQuote(). LPs must
// post both bid and ask. All quote logic is the shared postQuote() core.
export async function POST(request: NextRequest) {
  const reqLog = createRequestLogger(request);

  const auth = await requireApiUser(request, SCOPE_TRADE);
  if (!auth.ok) {
    reqLog.finish(auth.response.status);
    return auth.response;
  }
  const { user } = auth;

  try {
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
