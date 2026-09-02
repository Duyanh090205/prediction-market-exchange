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
import { auth } from "@/auth";
import { prisma } from "./prisma";

const LAB_JWT_SECRET = process.env.LAB_JWT_SECRET || "";

export interface LabUser {
  /** Trading-DB row id (string, matching NextAuth session.user.id shape) */
  id: string;
  email: string;
  username: string;
  /** "ADMIN" | "LIQUIDITY_PROVIDER" | "USER" */
  role: string;
  /**
   * Sandbox account minted by "Enter as demo trader". Always false under Lab
   * SSO — demo accounts only exist on the public standalone deployment.
   */
  isDemo: boolean;
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
  // Standalone mode. When no Lab SSO secret is configured — which is the case
  // for any deployment outside the Lab — authentication comes from this app's
  // own NextAuth credentials session instead. Every existing caller of
  // getLabUser() keeps working unchanged, because the return shape is identical.
  if (!LAB_JWT_SECRET) {
    const session = await auth();
    const su = session?.user as
      | {
          id?: string;
          email?: string | null;
          username?: string;
          role?: string;
          isDemo?: boolean;
        }
      | undefined;
    if (!su?.id) return null;
    return {
      id: String(su.id),
      email: su.email ?? "",
      username: su.username ?? "",
      role: su.role ?? "USER",
      isDemo: su.isDemo ?? false,
    };
  }


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

  // Email allowlist promoted to trading ADMIN (in addition to Lab's own
  // role=admin). Lets a known operator manage the env without a separate Lab
  // admin account — this still requires a valid Lab login (NOT an auth bypass).
  // ⚠️ Keep this on the `dev` branch — do NOT merge to snguyen_dev/prod, or
  // these emails become admin on production too.
  const ADMIN_EMAILS = new Set<string>([
    "nguyenanhkt9205@gmail.com",
  ]);
  const isAdminEmail = ADMIN_EMAILS.has(claims.email.toLowerCase());

  // Map Lab role to trading role
  const tradingRole =
    claims.role === "admin" || isAdminEmail ? "ADMIN" : "USER";

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
      // Promote allowlisted admins on every login (their account may already
      // exist as USER from a prior login, which the upsert would not change).
      ...(isAdminEmail ? { role: "ADMIN" as const } : {}),
    },
    select: { id: true, email: true, username: true, role: true },
  });

  return {
    id: String(user.id),
    email: user.email,
    username: user.username,
    role: user.role,
    isDemo: false,
  };
}
