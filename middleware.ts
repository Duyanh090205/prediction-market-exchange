import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

const PUBLIC_PAGES = ["/login", "/register"];
const PUBLIC_API_PREFIX = "/api/auth";

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

  // Everything else requires authentication
  if (!session) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
