// Server-side Socket.IO Event Emitter
//
// Used by Route Handlers (e.g., /api/orders, /api/contracts/[id]/settle)
// to push real-time events to connected clients.
//
// websocket-engineer: use rooms/namespaces for message scoping.
// Events are emitted to:
//   - `user:<userId>` room for portfolio updates
//   - `contract:<contractId>` room for order book updates

import type { Server } from "socket.io";

/**
 * Get the global Socket.IO server instance (set by server.js).
 * Returns null if running without the custom server (e.g., during `next dev`).
 */
function getIO(): Server | null {
  return (global as unknown as { __io?: Server }).__io ?? null;
}

// ─── Event Types ────────────────────────────────────────────────────────────

export interface TradeExecutedEvent {
  tradeId: number;
  contractId: number;
  quoteId: number;
  takerId: number;
  makerId: number;
  takerSide: "OVER" | "UNDER";
  strike: number;
  size: number;
}

export interface QuoteUpdatedEvent {
  quoteId: number;
  contractId: number;
  newSize: number;
  status: "OPEN" | "EXHAUSTED" | "CANCELLED";
}

export interface ContractSettledEvent {
  contractId: number;
  settlementValue: number;
}

// ─── Emit Helpers ───────────────────────────────────────────────────────────

/**
 * Emit when a trade is executed (instant match).
 * Notifies both taker and maker via their personal rooms,
 * and broadcasts to the contract room for order book watchers.
 */
export function emitTradeExecuted(event: TradeExecutedEvent): void {
  const io = getIO();
  if (!io) return;

  // L4 fix: chain .to() calls so each socket receives exactly ONE event,
  // even if they are in both the user room and the contract room.
  io.to(`user:${event.takerId}`)
    .to(`user:${event.makerId}`)
    .to(`contract:${event.contractId}`)
    .emit("TRADE_EXECUTED", event);
}

/**
 * Emit when a quote is updated (size decremented, exhausted, or cancelled).
 */
export function emitQuoteUpdated(event: QuoteUpdatedEvent): void {
  const io = getIO();
  if (!io) return;

  io.to(`contract:${event.contractId}`).emit("QUOTE_UPDATED", event);
}

/**
 * Emit when a contract is settled.
 * Notifies all users in the contract room.
 */
export function emitContractSettled(event: ContractSettledEvent): void {
  const io = getIO();
  if (!io) return;

  io.to(`contract:${event.contractId}`).emit("CONTRACT_SETTLED", event);
}
