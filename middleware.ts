import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

const PUBLIC_PAGES = ["/sso", "/auth-from-lab"];
const PUBLIC_API_PREFIX = "/api/auth";
const BASE_PATH = process.env.TRADING_BASE_PATH || "";

// Next.js strips basePath from req.nextUrl.pathname before middleware runs,
// so no manual normalization is needed here.
export default auth(function middleware(req) {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Always allow NextAuth's own API routes and health check
  if (pathname.startsWith(PUBLIC_API_PREFIX) || pathname === "/api/health") {
    return NextResponse.next();
  }

  // Public pages: allow through; redirect to / if already logged in
  if (PUBLIC_PAGES.includes(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    return NextResponse.next();
  }

  // Unauthenticated → same-origin bridge uses Lab JWT in localStorage (no second login)
  if (!session) {
    const bridge = req.nextUrl.clone();
    const prefix = BASE_PATH.replace(/\/$/, "");
    bridge.pathname = `${prefix}/auth-from-lab`.replace(/\/{2,}/g, "/") || "/auth-from-lab";
    bridge.search = "";
    
    // Ensure we don't end up with //trading or similar
    let dest = `${pathname}${req.nextUrl.search}`;
    if (BASE_PATH && !dest.startsWith(BASE_PATH)) {
      dest = `${BASE_PATH}${dest}`;
    }
    
    bridge.searchParams.set("next", dest || "/");
    return NextResponse.redirect(bridge);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
