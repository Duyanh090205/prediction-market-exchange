// Server-side Socket.IO Event Emitter
//
// Used by Route Handlers (e.g., /api/orders, /api/contracts/[id]/settle)
// to push real-time events to connected clients.
//
// websocket-engineer: use rooms/namespaces for message scoping.
//
// Two namespaces, mirroring how an exchange separates its feeds:
//   - `/`             authenticated. Order entry, positions, balances, chat,
//                     hints. Rooms: `user:<userId>` and `contract:<contractId>`.
//   - `/market-data`  public, no session. Order book, last price, confirmed
//                     trades. Rooms: `contract:<contractId>` only.
//
// Market-data events fan out to BOTH. Anything carrying identity or account
// state is emitted to the authenticated namespace only — see the notes on
// emitHintCreated and emitMessageCreated below.

import type { Namespace, Server } from "socket.io";

/**
 * Get the global Socket.IO server instance (set by server.js).
 * Returns null if running without the custom server (e.g., during `next dev`).
 */
function getIO(): Server | null {
  return (global as unknown as { __io?: Server }).__io ?? null;
}

/**
 * The public `/market-data` namespace (also set by server.js). Same null
 * contract as getIO(): absent under `next dev`, so every caller no-ops.
 */
function getPublicIO(): Namespace | null {
  return (global as unknown as { __ioPublic?: Namespace }).__ioPublic ?? null;
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
  bidSize: number | null;
  askSize: number | null;
  status: "OPEN" | "EXHAUSTED" | "CANCELLED";
}

export interface ContractSettledEvent {
  contractId: number;
  settlementValue: number;
}

// ─── Emit Helpers ───────────────────────────────────────────────────────────

/** The tape as a public feed carries it: the print, not the counterparties. */
export interface PublicTradeExecutedEvent {
  tradeId: number;
  contractId: number;
  takerSide: "OVER" | "UNDER";
  strike: number;
  size: number;
}

/**
 * Emit when a trade is executed (instant match).
 * Notifies both taker and maker via their personal rooms,
 * and broadcasts to the contract room for order book watchers.
 *
 * The public feed gets a reduced payload: price, size and aggressor side, with
 * takerId/makerId/quoteId withheld. Whose fill it was is account information,
 * and the public namespace has no accounts.
 */
export function emitTradeExecuted(event: TradeExecutedEvent): void {
  const io = getIO();
  if (io) {
    // L4 fix: chain .to() calls so each socket receives exactly ONE event,
    // even if they are in both the user room and the contract room.
    io.to(`user:${event.takerId}`)
      .to(`user:${event.makerId}`)
      .to(`contract:${event.contractId}`)
      .emit("TRADE_EXECUTED", event);
  }

  const pub = getPublicIO();
  if (pub) {
    const publicEvent: PublicTradeExecutedEvent = {
      tradeId: event.tradeId,
      contractId: event.contractId,
      takerSide: event.takerSide,
      strike: event.strike,
      size: event.size,
    };
    pub.to(`contract:${event.contractId}`).emit("TRADE_EXECUTED", publicEvent);
  }
}

/**
 * Emit when a quote is updated (size decremented, exhausted, or cancelled).
 * This is order-book depth, and the payload names no maker — public.
 */
export function emitQuoteUpdated(event: QuoteUpdatedEvent): void {
  getIO()?.to(`contract:${event.contractId}`).emit("QUOTE_UPDATED", event);
  getPublicIO()?.to(`contract:${event.contractId}`).emit("QUOTE_UPDATED", event);
}

/**
 * Emit when a contract is settled.
 * Notifies all users in the contract room. The settlement value is the
 * market's public outcome, so the public feed carries it too.
 */
export function emitContractSettled(event: ContractSettledEvent): void {
  getIO()?.to(`contract:${event.contractId}`).emit("CONTRACT_SETTLED", event);
  getPublicIO()?.to(`contract:${event.contractId}`).emit("CONTRACT_SETTLED", event);
}

export interface PriceUpdatedEvent {
  contractId: number;
  ts: string; // ISO timestamp
  mid: number;
  bestBid: number | null;
  bestAsk: number | null;
}

/**
 * Emit when the market mid-price of a contract moves (powers the live price
 * chart). Sent to the contract room as an incremental point — clients append
 * it rather than refetching the whole series. Derived from best bid/ask, which
 * the book already shows publicly.
 */
export function emitPriceUpdated(event: PriceUpdatedEvent): void {
  getIO()?.to(`contract:${event.contractId}`).emit("PRICE_UPDATED", event);
  getPublicIO()?.to(`contract:${event.contractId}`).emit("PRICE_UPDATED", event);
}

export interface ContractCreatedEvent {
  contractId: number;
  title: string;
}

/**
 * Emit when a new contract (market) is created. Broadcast to ALL connected
 * clients (not a room) so every open-markets list refreshes without a reload —
 * including the list a signed-out visitor is looking at.
 */
export function emitContractCreated(event: ContractCreatedEvent): void {
  getIO()?.emit("CONTRACT_CREATED", event);
  getPublicIO()?.emit("CONTRACT_CREATED", event);
}

export interface HintCreatedEvent {
  contractId: number;
  hint: {
    id: number;
    content: string;
    linkUrl: string | null;
    linkLabel: string | null;
    createdAt: string;
    author: { id: number; username: string; role: string };
  };
}

/**
 * Emit when a hint is posted on a contract. Sent to the contract room so anyone
 * viewing that market sees the new hint appear without a reload.
 *
 * Authenticated namespace only: a hint names its author, and the hint panel is
 * not rendered for signed-out visitors.
 */
export function emitHintCreated(event: HintCreatedEvent): void {
  const io = getIO();
  if (!io) return;

  io.to(`contract:${event.contractId}`).emit("HINT_CREATED", event);
}

export interface MessageCreatedEvent {
  id: number;
  contractId: number | null; // null = lobby or DM
  recipientId: number | null; // set = direct message to this user
  userId: number;
  username: string;
  body: string;
  createdAt: string; // ISO timestamp
}

/**
 * Emit a chat message. Routing mirrors the Message model:
 *   - DM (recipientId set)   → both participants' user rooms
 *   - market (contractId set) → that contract's room
 *   - lobby (both null)       → broadcast to everyone connected
 *
 * Authenticated namespace only, deliberately. "Everyone connected" here means
 * every signed-in socket; the public market-data namespace carries no chat, so
 * a lobby broadcast has no path to a signed-out visitor.
 */
export function emitMessageCreated(event: MessageCreatedEvent): void {
  const io = getIO();
  if (!io) return;

  if (event.recipientId != null) {
    io.to(`user:${event.userId}`).to(`user:${event.recipientId}`).emit("MESSAGE_CREATED", event);
  } else if (event.contractId != null) {
    io.to(`contract:${event.contractId}`).emit("MESSAGE_CREATED", event);
  } else {
    io.emit("MESSAGE_CREATED", event);
  }
}
