// Socket.IO Client Singleton
//
// websocket-engineer: automatic reconnection with exponential backoff,
// connection state management (connecting, connected, disconnecting)
//
// The server authenticates via the Lab `lab_session` cookie (or NextAuth
// session cookie as fallback). The browser sends cookies automatically with
// `credentials: true`.
//
// Usage in Client Components:
//   import { getSocket } from "@/lib/socket-client";
//   const socket = getSocket();
//   socket.on("TRADE_EXECUTED", (data) => { ... });

"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Get or create the Socket.IO client singleton.
 * websocket-engineer: implements exponential backoff reconnection.
 *
 * No userId in the handshake — the server reads session cookies from the
 * WebSocket upgrade request.
 */
export function getSocket(): Socket {
  // Reuse the existing socket while it is connected OR still (re)connecting.
  // Recreating a mid-connection socket caused a connect/disconnect loop (the
  // console churn). Only when it has permanently given up (active === false,
  // e.g. reconnection attempts exhausted after a long outage) do we tear it
  // down and create a fresh one — so real-time can recover without a page reload.
  if (socket && (socket.connected || socket.active)) {
    return socket;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socket = io({
    path: `${process.env.NEXT_PUBLIC_TRADING_BASE_PATH || ""}/socket.io`,
    // D2 fix: withCredentials sends the session cookie automatically
    withCredentials: true,
    // websocket-engineer: automatic reconnection with exponential backoff
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000, // Start at 1s
    reconnectionDelayMax: 30000, // Cap at 30s
    // websocket-engineer: use WebSocket transport first, fallback to polling
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    console.log("[WS] Connected:", socket?.id);
  });

  socket.on("disconnect", (reason: string) => {
    console.log("[WS] Disconnected:", reason);
  });

  socket.on("connect_error", (error: Error) => {
    console.error("[WS] Connection error:", error.message);
  });

  return socket;
}
