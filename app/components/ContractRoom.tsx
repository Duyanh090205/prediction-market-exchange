"use client";

// ContractRoom — joins the contract's WebSocket room so this page receives
// QUOTE_UPDATED / CONTRACT_SETTLED / TRADE_EXECUTED events for the contract
// being viewed.
//
// The server only broadcasts those events to `contract:<id>` (see
// lib/socket-events.ts), and the client never joined that room before — so
// order-book / settlement updates never arrived for observers (BUG-2).
//
// Which socket, and who owns the refresh, depends on the viewer:
//
//   signed in   the authenticated namespace. PortfolioLive (rendered by the
//               Navbar) owns that connection's lifecycle and already refreshes
//               the page on market events, so this component only manages room
//               membership and must NOT connect/disconnect the socket itself.
//               The same room also carries chat and hints.
//
//   signed out  the public /market-data namespace. There is no Navbar for a
//               visitor and therefore no PortfolioLive, so this component owns
//               the refresh as well — without it the book, the trades and the
//               chart sit frozen at whatever the page load returned.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getMarketDataSocket } from "@/lib/socket-client";

export default function ContractRoom({
  contractId,
  authed,
}: {
  contractId: number;
  authed: boolean;
}) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = getMarketDataSocket(authed);
    // Server requires a number (server.js ignores anything else on both
    // namespaces)
    const join = () => socket.emit("join:contract", contractId);

    // Exactly once per connection. Emitting unconditionally here queued a join
    // that socket.io flushed on connect, and the "connect" handler then sent a
    // second one — harmless server-side (rooms are a set) but it showed up as a
    // duplicate frame on the wire.
    if (socket.connected) join();
    socket.on("connect", join); // (re-)join on connect and after any reconnect

    // Same 500ms debounce PortfolioLive uses: each refresh re-runs the page's
    // server components, so a burst of fills coalesces into one round-trip.
    const debouncedRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 500);
    };

    if (!authed) {
      socket.on("TRADE_EXECUTED", debouncedRefresh);
      socket.on("QUOTE_UPDATED", debouncedRefresh);
      socket.on("CONTRACT_SETTLED", debouncedRefresh);
    }

    return () => {
      socket.off("connect", join);
      if (!authed) {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        socket.off("TRADE_EXECUTED", debouncedRefresh);
        socket.off("QUOTE_UPDATED", debouncedRefresh);
        socket.off("CONTRACT_SETTLED", debouncedRefresh);
      }
      socket.emit("leave:contract", contractId);
    };
  }, [contractId, authed, router]);

  return null;
}
