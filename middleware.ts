import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LAB_JWT_SECRET = process.env.LAB_JWT_SECRET || "";
// Lab SSO login page, supplied by the environment when this app is mounted
// inside the Lab. No default host here: that deployment is gone, and a dead
// hostname baked into a public repo is a reference a reader cannot resolve.
// Empty means standalone, and the fallback below is this app's own /login.
const LAB_LOGIN_URL = process.env.LAB_LOGIN_URL || "";
const BASE_PATH = process.env.TRADING_BASE_PATH ?? "";
const IS_PROD = process.env.NODE_ENV === "production";

// Routes that don't need an authenticated Lab session
const PUBLIC_PREFIXES = [
  "/api/auth",   // NextAuth internals (kept for signOut helper)
  "/api/health",
  "/api/v1",     // Programmatic API: Bearer-token auth (getApiUser), no Lab cookie/SSO redirect
  "/api/discord", // Discord OAuth start/callback + unlink: route handlers do their own getLabUser + state check; must not be swallowed by the /connect bridge (which would drop the OAuth ?code)
  "/api/demo",   // Demo sandbox sign-up: unauthenticated by design, guarded by CSRF + per-IP budget + cap (lib/demoAccounts.ts)
  "/api/cron",   // Scheduled maintenance: every handler checks Authorization: Bearer CRON_SECRET itself. Without this the session gate here redirected the scheduler to /login, so none of them could ever run in standalone mode.
  "/connect",    // Cookie-bridge page: reads Lab localStorage token and exchanges it for a lab_session cookie
];

// Public API endpoints that a prefix cannot express. Matched exactly, so
// opening the price series does not open POST /api/contracts (create market) or
// /api/contracts/<id>/settle alongside it.
const PUBLIC_API_PATTERNS = [/^\/api\/contracts\/\d+\/price-history$/];

// Pages an unauthenticated visitor may open in standalone mode. The market list
// and each market's page are readable without an account — a login wall is half
// the reason a demo link gets ignored. Those pages gate every write surface on
// the session themselves; /markets/create is not listed here and stays private.
const PUBLIC_PAGES = ["/", "/markets", "/demo", "/login", "/register", "/reset-password"];

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
  if (PUBLIC_API_PATTERNS.some((re) => re.test(pathname))) {
    return pass();
  }

  // Standalone mode. No Lab SSO secret configured means this deployment lives
  // outside the Lab, so it authenticates with its own NextAuth credentials
  // session. Middleware only checks that a session cookie is present; getLabUser()
  // does the real verification on every page and route.
  if (!LAB_JWT_SECRET) {
    if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return pass();
    }
    const hasSession =
      req.cookies.get("authjs.session-token")?.value ??
      req.cookies.get("__Secure-authjs.session-token")?.value;
    if (hasSession) return pass();
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("next", pathname);
    return withCsp(NextResponse.redirect(login));
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
      const dest = LAB_LOGIN_URL
        ? new URL(
            `${LAB_LOGIN_URL}?redirect=${encodeURIComponent(req.nextUrl.href)}&reason=jwt_verify_failed&err=${encodeURIComponent(err.message || 'unknown')}`
          )
        : new URL("/login", req.nextUrl.origin);
      const res = NextResponse.redirect(dest);
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
