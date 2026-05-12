"use client";

import { SessionProvider } from "next-auth/react";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

const sessionBasePath = withTradingBasePath("/api/auth");

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath={sessionBasePath}>{children}</SessionProvider>;
}
