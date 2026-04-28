"use client";

// PortfolioLive — Client Component for real-time WebSocket portfolio updates
//
// nextjs-expert: Push 'use client' boundary down to the interactive leaf.
// The parent Navbar remains a Server Component.
//
// websocket-engineer: connect on mount, cleanup on unmount,
// listen for TRADE_EXECUTED + CONTRACT_SETTLED events to trigger
// a lightweight router.refresh() that re-fetches server data.
//
// L3 fix: debounce rapid WS events (e.g., 5-quote sweep) into a single refresh.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSocket, disconnectSocket } from "@/lib/socket-client";

// No props needed — the socket authenticates via session cookie
export default function PortfolioLive() {
  const router = useRouter();
  const connectedRef = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;

    const socket = getSocket();

    // L3 fix: debounce rapid refresh calls into a single 300ms window
    const debouncedRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 300);
    };

    // When a trade is executed (we are either taker or maker), refresh
    socket.on("TRADE_EXECUTED", debouncedRefresh);

    // When a contract settles, refresh to show updated balances
    socket.on("CONTRACT_SETTLED", debouncedRefresh);

    // When a quote is updated (order book changed), refresh
    socket.on("QUOTE_UPDATED", debouncedRefresh);

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      disconnectSocket();
      connectedRef.current = false;
    };
  }, [router]);

  // This component renders nothing — it's purely a side-effect hook
  return null;
}
