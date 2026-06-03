/**
 * CSRF Protection — strict origin/referer validation.
 *
 * Rules for state-changing requests:
 *   1. NEXTAUTH_URL must be configured (server misconfig → reject).
 *   2. Origin header must be present and match. If absent, fall back to
 *      Referer (some legitimate clients omit Origin on same-site DELETE).
 *      If both absent → reject.
 *   3. POST/PUT/PATCH must declare Content-Type: application/json (mitigates
 *      cross-origin form posts).
 */

import { NextResponse } from "next/server";
import { logError } from "@/lib/logger";

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function validateCsrf(request: Request): {
  valid: boolean;
  error?: string;
} {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { valid: true };
  }

  const rawExpected = process.env.NEXTAUTH_URL;
  if (!rawExpected) {
    logError(method, new URL(request.url).pathname, new Error("NEXTAUTH_URL unset — refusing all state-changing requests"));
    return { valid: false, error: "Server misconfiguration" };
  }
  // NEXTAUTH_URL may include a basePath (e.g. https://host/trading), but the
  // browser Origin header is always bare (scheme://host). Compare origins only
  // — mirrors how server.js derives corsOrigin. (Comparing the raw string
  // rejected every same-origin POST when NEXTAUTH_URL carried the /trading path.)
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(rawExpected).origin;
  } catch {
    logError(method, new URL(request.url).pathname, new Error("NEXTAUTH_URL is not a valid URL"));
    return { valid: false, error: "Server misconfiguration" };
  }

  const origin = request.headers.get("origin");
  const refererOrigin = originFromReferer(request.headers.get("referer"));
  const effective = origin ?? refererOrigin;

  if (!effective) {
    return { valid: false, error: "Missing Origin/Referer" };
  }
  if (effective !== expectedOrigin) {
    return { valid: false, error: "Invalid origin" };
  }

  if (method === "DELETE") {
    return { valid: true };
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return {
      valid: false,
      error: "Content-Type must be application/json",
    };
  }

  return { valid: true };
}

export function csrfGuard(request: Request): NextResponse | null {
  const result = validateCsrf(request);
  if (!result.valid) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  return null;
}
