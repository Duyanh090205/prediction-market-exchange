import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

const PUBLIC_PAGES = ["/sso", "/auth-from-lab", "/login"];
const PUBLIC_API_PREFIX = "/api/auth";
const BASE_PATH = process.env.TRADING_BASE_PATH || "";

// Next.js strips basePath from req.nextUrl.pathname before middleware runs,
// so pathname here is always relative to the basePath (e.g. "/" not "/trading/").
export default auth(function middleware(req) {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Always allow NextAuth's own API routes and health check
  if (pathname.startsWith(PUBLIC_API_PREFIX) || pathname === "/api/health") {
    return NextResponse.next();
  }

  // Public pages: allow through unauthenticated
  if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Unauthenticated → SSO bridge (reads Lab JWT from localStorage, exchanges for trading session).
  // Falls back to /login (Google Sign-In) if no Lab token is found.
  if (!session) {
    const bridge = req.nextUrl.clone();
    const prefix = BASE_PATH.replace(/\/$/, "");
    bridge.pathname = `${prefix}/auth-from-lab`;
    bridge.search = "";
    const dest = `${pathname}${req.nextUrl.search}`;
    bridge.searchParams.set("next", dest || "/");
    return NextResponse.redirect(bridge);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
