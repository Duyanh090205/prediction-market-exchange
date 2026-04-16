/**
 * CSRF Protection
 *
 * Two checks on all state-changing (non-GET) Route Handlers:
 * 1. Origin header must match NEXTAUTH_URL
 * 2. Content-Type must be application/json (reject plain form POSTs)
 *
 * NextAuth handles CSRF for its own auth endpoints automatically.
 */

import { NextResponse } from "next/server";

export function validateCsrf(request: Request): {
  valid: boolean;
  error?: string;
} {
  // Only check state-changing methods
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { valid: true };
  }

  // Check Origin header
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.NEXTAUTH_URL;

  if (expectedOrigin && origin && origin !== expectedOrigin) {
    return { valid: false, error: "Invalid origin" };
  }

  // Require Content-Type: application/json
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return {
      valid: false,
      error: "Content-Type must be application/json",
    };
  }

  return { valid: true };
}

/**
 * Convenience: validate CSRF and return NextResponse if invalid.
 * Use at the top of Route Handlers:
 *
 *   const csrfError = csrfGuard(request);
 *   if (csrfError) return csrfError;
 */
export function csrfGuard(request: Request): NextResponse | null {
  const result = validateCsrf(request);
  if (!result.valid) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  return null;
}
