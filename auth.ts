import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from "@/lib/rate-limiter";
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Password policy: minimum 8 characters
        if (password.length < 8) {
          return null;
        }

        // Rate limit check BEFORE bcrypt — prevents timing-based DoS
        const ip =
          request.headers
            .get("x-forwarded-for")
            ?.split(",")[0]
            ?.trim() ??
          request.headers.get("x-real-ip") ??
          "unknown";

        const rateLimitResult = checkRateLimit(ip);
        if (!rateLimitResult.allowed) {
          throw new Error(
            "Too many login attempts. Please try again in 15 minutes."
          );
        }

        // Find user by email
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          recordFailedAttempt(ip);
          return null;
        }

        // Verify password with bcrypt (work factor 12 was used at hash time)
        const isValid = await bcrypt.compare(password, user.hashedPassword);
        if (!isValid) {
          recordFailedAttempt(ip);
          return null;
        }

        // Successful login — reset rate limit counter
        resetRateLimit(ip);

        return {
          id: String(user.id),
          email: user.email,
          name: user.username,
          role: user.role,
          username: user.username,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, persist role and username into the JWT
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.username = (user as { username?: string }).username;
      }
      return token;
    },

    async session({ session, token }) {
      // Session re-validation: refetch user from DB on every request
      // Invalidate if user deleted or role changed
      if (!token.id) {
        return session;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: Number(token.id) },
        select: { id: true, role: true, username: true },
      });

      if (!dbUser) {
        // User was deleted — invalidate session
        session.user = undefined as unknown as typeof session.user;
        return session;
      }

      if (dbUser.role !== token.role) {
        // Role changed — update token and session
        token.role = dbUser.role;
      }

      session.user.id = String(dbUser.id);
      session.user.role = dbUser.role;
      session.user.username = dbUser.username;

      return session;
    },
  },
});
