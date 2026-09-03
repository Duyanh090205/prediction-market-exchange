/**
 * The current user, resolved from this app's own NextAuth session.
 *
 * The name is historical: this began as the resolver for an external SSO
 * cookie, and every page and route handler calls getLabUser(). That path is
 * gone. The name stays because renaming it touches thirty-six files for no
 * change in behaviour.
 *
 * Usage in server components / route handlers:
 *   const user = await getLabUser();
 *   if (!user) redirect("/login");
 */

import { auth } from "@/auth";

export interface LabUser {
  /** Trading-DB row id (string, matching NextAuth session.user.id shape) */
  id: string;
  email: string;
  username: string;
  /** "ADMIN" | "LIQUIDITY_PROVIDER" | "USER" */
  role: string;
  /** Sandbox account minted by "Enter as demo trader". */
  isDemo: boolean;
}

export async function getLabUser(): Promise<LabUser | null> {
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
