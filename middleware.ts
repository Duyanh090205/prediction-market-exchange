import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

const PUBLIC_PAGES = ["/sso"];
const PUBLIC_API_PREFIX = "/api/auth";
const LAB_LOGIN_URL = process.env.LAB_LOGIN_URL || "https://lab.iterlight.com/login";

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

  // Everything else requires authentication — unauthenticated users go to Lab login
  if (!session) {
    const loginUrl = new URL(LAB_LOGIN_URL);
    loginUrl.searchParams.set("next", req.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
