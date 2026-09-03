import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  // Required behind a reverse proxy (Render terminates TLS in front of the
  // app). Without it Auth.js rejects the forwarded host as untrusted.
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
