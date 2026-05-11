import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  // Required behind DigitalOcean ingress / path-prefix routing (reverse proxy).
  // Without this, Auth.js throws UntrustedHost for https://lab.iterlight.com/trading/...
  trustHost: true,
  providers: [],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
} satisfies NextAuthConfig;
