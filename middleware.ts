import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LAB_JWT_SECRET = process.env.LAB_JWT_SECRET || "";
const LAB_LOGIN_URL = process.env.LAB_LOGIN_URL || "https://lab.iterlight.com/login";
const BASE_PATH = process.env.TRADING_BASE_PATH || "/trading";
const IS_PROD = process.env.NODE_ENV === "production";

// Routes that don't need an authenticated Lab session
const PUBLIC_PREFIXES = [
  "/api/auth",   // NextAuth internals (kept for signOut helper)
  "/api/health",
  "/api/v1",     // Programmatic API: Bearer-token auth (getApiUser), no Lab cookie/SSO redirect
  "/connect",    // Cookie-bridge page: reads Lab localStorage token and exchanges it for a lab_session cookie
];

// Per-request Content-Security-Policy. Production allows Next.js's inline
// bootstrap scripts via a fresh per-request nonce + 'strict-dynamic' (no
// 'unsafe-inline', so attacker-injected inline scripts stay blocked). Dev relaxes
// it for Turbopack/HMR. (Previously a static CSP in next.config.ts used
// `script-src 'self'`, which blocked Next's own inline scripts → blank pages.)
function buildCsp(nonce: string): string {
  const scriptSrc = IS_PROD
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Fresh nonce per request. `pass()` lets the request through while carrying the
  // nonce to the SSR (request header — Next.js reads it and stamps its own
  // <script> tags) and to the browser (response header). `withCsp()` attaches the
  // same header to redirect responses.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // Always allow static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon")
  ) {
    return pass();
  }

  // Allow public API prefixes
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return pass();
  }

  const token = req.cookies.get("lab_session")?.value;

  if (token && LAB_JWT_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(LAB_JWT_SECRET), {
        clockTolerance: 60, // 1 minute tolerance for clock skew
      });
      return pass();
    } catch (err: any) {
      // Expired or tampered — clear cookie and fall through to redirect
      const res = NextResponse.redirect(
        new URL(`${LAB_LOGIN_URL}?redirect=${encodeURIComponent(req.nextUrl.href)}&reason=jwt_verify_failed&err=${encodeURIComponent(err.message || 'unknown')}`)
      );
      res.cookies.set("lab_session", "", { maxAge: 0, path: "/" });
      return withCsp(res);
    }
  }

  // No cookie — go to the cookie-bridge page first.
  // The bridge reads the Lab localStorage token and exchanges it for a lab_session
  // cookie via the Lab backend, then forwards to the original destination.
  // If no Lab token exists the bridge sends the user to Lab login.
  const dest = req.nextUrl.href;
  const connectUrl = new URL(`${BASE_PATH}/connect`, req.nextUrl.origin);
  connectUrl.searchParams.set("next", dest);
  return withCsp(NextResponse.redirect(connectUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
