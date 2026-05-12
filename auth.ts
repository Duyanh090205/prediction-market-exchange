import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  resetLoginRateLimit,
} from "@/lib/rate-limiter";
import { authConfig } from "./auth.config";

type LabSsoClaims = {
  sub: string;
  email: string;
  role?: string;
  preferred_username?: string;
  platformsEnabled?: string[];
};

async function resolveGoogleUser(idToken: string) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google client ID not configured");

  const resp = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!resp.ok) return null;

  const payload = await resp.json();

  // Reject tokens issued for a different client
  if (payload.aud !== clientId) return null;
  if (!payload.email || !payload.email_verified) return null;

  const email = payload.email as string;
  const sub = payload.sub as string;
  const username = `${email.split("@")[0].slice(0, 48)}-g${sub.slice(-6)}`.slice(0, 64);

  const randomPassword = randomBytes(32).toString("hex");
  const hashedPassword = await bcrypt.hash(randomPassword, 12);

  return prisma.user.upsert({
    where: { email },
    create: { email, username, hashedPassword, status: "ACTIVE", role: "USER" },
    update: { status: "ACTIVE" },
  });
}

async function resolveSsoUser(ssoToken: string) {
  const sharedSecret = process.env.LAB_SSO_SHARED_SECRET;
  if (!sharedSecret) {
    throw new Error("SSO secret is not configured");
  }

  const { payload } = await jwtVerify(
    ssoToken,
    new TextEncoder().encode(sharedSecret),
    {
      issuer: process.env.LAB_SSO_ISSUER || "iterlight-lab-backend",
      audience: process.env.LAB_SSO_AUDIENCE || "trading-game-platform",
    }
  );

  const claims = payload as unknown as LabSsoClaims;
  if (!claims.email || !claims.sub) {
    throw new Error("SSO token is missing required claims");
  }

  if (Array.isArray(claims.platformsEnabled) && !claims.platformsEnabled.includes("lab")) {
    throw new Error("Lab access is required for trading");
  }

  const baseUsername =
    claims.preferred_username?.slice(0, 48) || claims.email.split("@")[0].slice(0, 48);
  const usernameCandidate = `${baseUsername}-${claims.sub.slice(-8)}`.slice(0, 64);
  const role = claims.role === "admin" ? "ADMIN" : "USER";

  const randomPassword = randomBytes(32).toString("hex");
  const hashedPassword = await bcrypt.hash(randomPassword, 12);

  return prisma.user.upsert({
    where: { email: claims.email },
    create: {
      email: claims.email,
      username: usernameCandidate || `user-${claims.sub}`,
      hashedPassword,
      status: "ACTIVE",
      role,
    },
    update: {
      status: "ACTIVE",
    },
  });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        ssoToken: { label: "SSO Token", type: "text" },
        googleIdToken: { label: "Google ID Token", type: "text" },
      },
      async authorize(credentials, request) {
        // Google Sign-In via GSI (id token verified against tokeninfo endpoint)
        const googleIdToken = credentials?.googleIdToken as string | undefined;
        if (googleIdToken) {
          const user = await resolveGoogleUser(googleIdToken);
          if (!user) return null;
          return {
            id: String(user.id),
            email: user.email,
            name: user.username,
            role: user.role,
            username: user.username,
          };
        }

        // Lab SSO handoff (signed JWT from lab backend)
        const ssoToken = credentials?.ssoToken as string | undefined;
        if (ssoToken) {
          const user = await resolveSsoUser(ssoToken);
          return {
            id: String(user.id),
            email: user.email,
            name: user.username,
            role: user.role,
            username: user.username,
          };
        }

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

        const rateLimitResult = await checkLoginRateLimit(ip);
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
          await recordLoginFailure(ip, email);
          return null;
        }

        // Verify password with bcrypt (work factor 12 was used at hash time)
        const isValid = await bcrypt.compare(password, user.hashedPassword);
        if (!isValid) {
          await recordLoginFailure(ip, email);
          return null;
        }

        // Block PENDING / SUSPENDED users at the credential layer
        if (user.status !== "ACTIVE") {
          await recordLoginFailure(ip, email);
          throw new Error(
            user.status === "PENDING"
              ? "Account pending admin approval"
              : "Account suspended"
          );
        }

        // Successful login — reset rate limit counter
        await resetLoginRateLimit(ip);

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
      // Session re-validation with 30s cache:
      //   - Reduces DB roundtrip on every page render (prod scale).
      //   - Role/status changes propagate within 30s.
      //   - User deletion is also detected within 30s.
      if (!token.id) return session;

      const now = Date.now();
      const lastChecked = (token.lastChecked as number | undefined) ?? 0;
      const SESSION_REVALIDATE_MS = 30_000;

      if (now - lastChecked < SESSION_REVALIDATE_MS && token.role && token.username) {
        // Cache hit — use values already on the token.
        session.user.id = String(token.id);
        session.user.role = token.role as string;
        session.user.username = token.username as string;
        return session;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: Number(token.id) },
        select: { id: true, role: true, username: true, status: true },
      });

      if (!dbUser || dbUser.status !== "ACTIVE") {
        // Deleted, suspended, or pending — invalidate session
        session.user = undefined as unknown as typeof session.user;
        return session;
      }

      token.role = dbUser.role;
      token.username = dbUser.username;
      token.lastChecked = now;

      session.user.id = String(dbUser.id);
      session.user.role = dbUser.role;
      session.user.username = dbUser.username;

      return session;
    },
  },
});
