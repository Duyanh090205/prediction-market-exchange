// Socket.IO Client Singletons
//
// websocket-engineer: automatic reconnection with exponential backoff,
// connection state management (connecting, connected, disconnecting)
//
// Two namespaces, matching server.js:
//
//   "/"              authenticated. The server reads the NextAuth session
//                    cookie off the WebSocket upgrade request and rejects the
//                    handshake without one.
//                    Carries order fills, positions, chat, hints.
//
//   "/market-data"   public. No session, no cookies, no user identity. Carries
//                    the order book, the last traded price and confirmed
//                    trades — what a signed-out visitor is shown.
//
// Use getMarketDataSocket(authed) for anything that only needs market data. It
// keeps a signed-in viewer on the authenticated connection (one socket per
// viewer, not two) and puts a visitor on the public one, where connecting
// without a session is the expected case rather than an error.
//
// Usage in Client Components:
//   import { getMarketDataSocket } from "@/lib/socket-client";
//   const socket = getMarketDataSocket(authed);
//   socket.on("TRADE_EXECUTED", (data) => { ... });

"use client";

import { io, Socket } from "socket.io-client";

let authedSocket: Socket | null = null;
let publicSocket: Socket | null = null;

const SOCKET_PATH = `${process.env.NEXT_PUBLIC_TRADING_BASE_PATH || ""}/socket.io`;

// Reuse an existing socket while it is connected OR still (re)connecting.
// Recreating a mid-connection socket caused a connect/disconnect loop (the
// console churn). Only when it has permanently given up (active === false,
// e.g. reconnection attempts exhausted after a long outage) do we tear it down
// and create a fresh one — so real-time can recover without a page reload.
function reusable(existing: Socket | null): Socket | null {
  if (existing && (existing.connected || existing.active)) return existing;
  if (existing) existing.disconnect();
  return null;
}

function connect(namespace: string, withCredentials: boolean, label: string): Socket {
  const socket = io(namespace, {
    path: SOCKET_PATH,
    // D2 fix: withCredentials sends the session cookie automatically. The
    // public namespace has nothing to authenticate, so it sends none.
    withCredentials,
    // websocket-engineer: automatic reconnection with exponential backoff
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000, // Start at 1s
    reconnectionDelayMax: 30000, // Cap at 30s
    // websocket-engineer: use WebSocket transport first, fallback to polling
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    console.log(`[WS ${label}] Connected:`, socket.id);
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[WS ${label}] Disconnected:`, reason);
  });

  socket.on("connect_error", (error: Error) => {
    console.error(`[WS ${label}] Connection error:`, error.message);
  });

  return socket;
}

/**
 * The authenticated socket (default namespace). Only mount components that use
 * it behind a signed-in check — without a session the server refuses the
 * handshake, which is correct but shows up as a console error.
 */
export function getSocket(): Socket {
  authedSocket = reusable(authedSocket) ?? connect("/", true, "private");
  return authedSocket;
}

/**
 * The public market-data socket. Connects with no session and is never placed
 * in a `user:<id>` room, so it can only ever receive order book, price and
 * trade events.
 */
export function getPublicSocket(): Socket {
  publicSocket = reusable(publicSocket) ?? connect("/market-data", false, "market-data");
  return publicSocket;
}

/**
 * Pick the right feed for a market-data consumer. Both namespaces emit the
 * same market-data event names, so a component subscribes identically either
 * way; the authenticated payload for TRADE_EXECUTED simply carries extra
 * fields (counterparty ids) that market-data consumers do not read.
 */
export function getMarketDataSocket(authed: boolean): Socket {
  return authed ? getSocket() : getPublicSocket();
}
