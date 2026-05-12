/**
 * Central Lab session resolver for the trading app.
 *
 * The Lab backend sets an HTTP-only `lab_session` cookie (containing the Lab
 * JWT) on every successful login.  Because Lab and Trading share the same
 * origin (lab.iterlight.com) the cookie arrives on every trading request
 * automatically — no SSO bridge or localStorage juggling required.
 *
 * Usage in server components / route handlers:
 *   const user = await getLabUser();
 *   if (!user) redirect("/");   // middleware should have caught this already
 */

import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { prisma } from "./prisma";

const LAB_JWT_SECRET = process.env.LAB_JWT_SECRET || "";

export interface LabUser {
  /** Trading-DB row id (string, matching NextAuth session.user.id shape) */
  id: string;
  email: string;
  username: string;
  /** "ADMIN" | "LIQUIDITY_PROVIDER" | "USER" */
  role: string;
}

interface LabJwtPayload {
  userId: number;
  email: string;
  role?: string;
  platformsEnabled?: string[];
  iat?: number;
  exp?: number;
}

export async function getLabUser(): Promise<LabUser | null> {
  if (!LAB_JWT_SECRET) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get("lab_session")?.value;
  if (!token) return null;

  let claims: LabJwtPayload;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(LAB_JWT_SECRET),
      { clockTolerance: 60 }
    );
    claims = payload as unknown as LabJwtPayload;
  } catch {
    return null;
  }

  if (!claims.email) return null;

  // Map Lab role to trading role
  const tradingRole =
    claims.role === "admin" ? "ADMIN" : "USER";

  // Upsert: create trading user on first Lab login, keep existing data otherwise
  const username = `${claims.email.split("@")[0].slice(0, 48)}-${String(claims.userId).slice(-6)}`.slice(0, 64);

  const user = await prisma.user.upsert({
    where: { email: claims.email },
    create: {
      email: claims.email,
      username,
      // Password field is required by schema but unused — Lab is the auth source
      hashedPassword: `lab-sso:${claims.userId}`,
      status: "ACTIVE",
      role: tradingRole,
    },
    update: {
      status: "ACTIVE",
    },
    select: { id: true, email: true, username: true, role: true },
  });

  return {
    id: String(user.id),
    email: user.email,
    username: user.username,
    role: user.role,
  };
}
