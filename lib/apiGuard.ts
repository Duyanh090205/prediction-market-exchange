/**
 * Entry guard for /api/v1 routes: Bearer auth → per-key rate limit → scope check.
 *
 * Usage in a route handler:
 *   const auth = await requireApiUser(request, SCOPE_READ);
 *   if (!auth.ok) { reqLog.finish(auth.response.status); return auth.response; }
 *   const { user } = auth;
 */

import { NextResponse } from "next/server";
import { getApiUser, hasScope, type ApiUser, type Scope } from "@/lib/apiAuth";
import { checkApiRateLimit, recordApiRequest } from "@/lib/rate-limiter";

export type ApiAuthResult =
  | { ok: true; user: ApiUser }
  | { ok: false; response: NextResponse };

export async function requireApiUser(
  request: Request,
  scope: Scope
): Promise<ApiAuthResult> {
  // A DB hiccup while resolving the key must surface as a clean, logged 503 —
  // not an unlogged 500 (requireApiUser runs before the route's try/catch).
  let user: ApiUser | null;
  try {
    user = await getApiUser(request);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      ),
    };
  }
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized — provide a valid 'Authorization: Bearer tgk_...' API key" },
        { status: 401 }
      ),
    };
  }

  // Per-key rate limit (keyed by ApiKey id, not user, so each key has its own budget).
  const rlKey = String(user.apiKeyId);
  const rl = await checkApiRateLimit(rlKey);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 60_000) / 1000);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      ),
    };
  }
  await recordApiRequest(rlKey);

  if (!hasScope(user, scope)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `This API key is missing the required '${scope}' scope` },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}
