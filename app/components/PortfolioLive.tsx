"use client";

// PortfolioLive — Client Component for real-time WebSocket portfolio updates
//
// nextjs-expert: Push 'use client' boundary down to the interactive leaf.
// The parent Navbar remains a Server Component.
//
// websocket-engineer: subscribe to TRADE_EXECUTED / CONTRACT_SETTLED /
// QUOTE_UPDATED and trigger a debounced router.refresh().
//
// Cleanup removes ONLY this component's listeners — it does NOT disconnect the
// shared singleton socket. Tearing the socket down on every unmount (and under
// React StrictMode / Fast Refresh in dev) caused a connect/disconnect loop.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket-client";

// No props needed — the socket authenticates via session cookie
export default function PortfolioLive() {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = getSocket();

    // Debounce rapid refresh calls into a single window. Each refresh re-runs
    // the page's server components (incl. Navbar margin), so coalescing bursts
    // of trade/quote events keeps active markets from feeling laggy.
    const debouncedRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 500);
    };

    socket.on("TRADE_EXECUTED", debouncedRefresh);
    socket.on("CONTRACT_SETTLED", debouncedRefresh);
    socket.on("QUOTE_UPDATED", debouncedRefresh);

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      socket.off("TRADE_EXECUTED", debouncedRefresh);
      socket.off("CONTRACT_SETTLED", debouncedRefresh);
      socket.off("QUOTE_UPDATED", debouncedRefresh);
    };
  }, [router]);

  // This component renders nothing — it's purely a side-effect hook
  return null;
}
