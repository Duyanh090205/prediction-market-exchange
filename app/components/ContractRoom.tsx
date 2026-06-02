"use client";

// ContractRoom — joins the contract's WebSocket room so this page receives
// QUOTE_UPDATED / CONTRACT_SETTLED / TRADE_EXECUTED events for the contract
// being viewed.
//
// The server only broadcasts those events to `contract:<id>` (see
// lib/socket-events.ts), and the client never joined that room before — so
// order-book / settlement updates never arrived for observers (BUG-2).
//
// PortfolioLive (rendered by the Navbar) owns the socket connection lifecycle
// and already listens for these events to trigger a router.refresh(). This
// component only manages room membership for the current page, so it must NOT
// connect/disconnect the socket itself.

import { useEffect } from "react";
import { getSocket } from "@/lib/socket-client";

export default function ContractRoom({ contractId }: { contractId: number }) {
  useEffect(() => {
    const socket = getSocket();
    // Server requires a number (server.js: typeof contractId !== "number" → ignored)
    const join = () => socket.emit("join:contract", contractId);

    join(); // queued by socket.io if not yet connected, flushed on connect
    socket.on("connect", join); // re-join after any reconnect

    return () => {
      socket.off("connect", join);
      socket.emit("leave:contract", contractId);
    };
  }, [contractId]);

  return null;
}
