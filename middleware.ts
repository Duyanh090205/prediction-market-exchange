import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LAB_JWT_SECRET = process.env.LAB_JWT_SECRET || "";
const LAB_LOGIN_URL = process.env.LAB_LOGIN_URL || "https://lab.iterlight.com/login";
const BASE_PATH = process.env.TRADING_BASE_PATH || "/trading";

// Routes that don't need an authenticated Lab session
const PUBLIC_PREFIXES = [
  "/api/auth",   // NextAuth internals (kept for signOut helper)
  "/api/health",
  "/connect",    // Cookie-bridge page: reads Lab localStorage token and exchanges it for a lab_session cookie
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Allow public API prefixes
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("lab_session")?.value;

  if (token && LAB_JWT_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(LAB_JWT_SECRET), {
        clockTolerance: 60, // 1 minute tolerance for clock skew
      });
      return NextResponse.next();
    } catch (err: any) {
      // Expired or tampered — clear cookie and fall through to redirect
      const res = NextResponse.redirect(
        new URL(`${LAB_LOGIN_URL}?redirect=${encodeURIComponent(req.nextUrl.href)}&reason=jwt_verify_failed&err=${encodeURIComponent(err.message || 'unknown')}`)
      );
      res.cookies.set("lab_session", "", { maxAge: 0, path: "/" });
      return res;
    }
  }

  // No cookie — go to the cookie-bridge page first.
  // The bridge reads the Lab localStorage token and exchanges it for a lab_session
  // cookie via the Lab backend, then forwards to the original destination.
  // If no Lab token exists the bridge sends the user to Lab login.
  const dest = req.nextUrl.href;
  const connectUrl = new URL(`${BASE_PATH}/connect`, req.nextUrl.origin);
  connectUrl.searchParams.set("next", dest);
  return NextResponse.redirect(connectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
