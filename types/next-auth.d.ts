import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      username: string;
      /** Sandbox account from "Enter as demo trader" — see lib/demoAccounts.ts */
      isDemo: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    username?: string;
    isDemo?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    username?: string;
    isDemo?: boolean;
  }
}
