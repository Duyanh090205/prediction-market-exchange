import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const IS_PROD = process.env.NODE_ENV === "production";

// Routes that never need a session.
const PUBLIC_PREFIXES = [
  "/api/auth",   // NextAuth internals (kept for signOut helper)
  "/api/health",
  "/api/v1",     // Programmatic API: Bearer-token auth (getApiUser), no Lab cookie/SSO redirect
  "/api/discord", // Discord OAuth start/callback + unlink: route handlers do their own getLabUser + state check; must not be swallowed by the /connect bridge (which would drop the OAuth ?code)
  "/api/demo",   // Demo sandbox sign-up: unauthenticated by design, guarded by CSRF + per-IP budget + cap (lib/demoAccounts.ts)
  "/api/cron",   // Scheduled maintenance: every handler checks Authorization: Bearer CRON_SECRET itself. Without this the session gate here redirected the scheduler to /login, so none of them could ever run in standalone mode.
];

// Public API endpoints that a prefix cannot express. Matched exactly, so
// opening the price series does not open POST /api/contracts (create market) or
// /api/contracts/<id>/settle alongside it.
const PUBLIC_API_PATTERNS = [/^\/api\/contracts\/\d+\/price-history$/];

// Pages an unauthenticated visitor may open in standalone mode. The market list
// and each market's page are readable without an account — a login wall is half
// the reason a demo link gets ignored. Those pages gate every write surface on
// the session themselves; /markets/create is not listed here and stays private.
const PUBLIC_PAGES = ["/", "/markets", "/settled", "/leaderboard", "/demo", "/login", "/register", "/reset-password"];

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


  // Always allow static assets, including the generated icon and social card.
  // Those two are fetched by crawlers with no session — a link pasted into
  // Slack or LinkedIn is unfurled by a bot, not by the person pasting it — and
  // the session gate was redirecting them to /login, so the preview would have
  // silently come back blank however well the image was drawn.
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon" ||
    pathname === "/opengraph-image"
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

  // Pages a signed-out visitor may open are listed above; everything else
  // needs this app's own NextAuth session. Middleware only checks that the
  // cookie is present — getLabUser() verifies it on every page and route.
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
