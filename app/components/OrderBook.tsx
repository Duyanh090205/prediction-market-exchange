"use client";

// Unified order-book ladder (Sam #1). ALL open quotes — the creator's primary
// market and every player's quotes/resting limit orders — aggregated by price
// level into one book, because the engine matches across all of them
// best-price-first. Asks stack above the spread, bids below, with per-level
// depth bars. ★ marks levels that include the market creator. Clicking a level
// expands who is quoting there.

import { useState } from "react";
import Link from "next/link";
import AdminQuoteDelete from "./AdminQuoteDelete";

export interface BookEntry {
  quoteId: number;
  makerId: number;
  username: string;
  size: number;
  isCreator: boolean;
  isYou: boolean;
}

export interface BookLevel {
  price: number;
  size: number;
  hasCreator: boolean;
  entries: BookEntry[];
}

interface OrderBookProps {
  /** Sorted best-first: asks ascending, bids descending. */
  asks: BookLevel[];
  bids: BookLevel[];
  isAdmin: boolean;
}

const GREEN = "#22c55e";
const RED = "#ef4444";

export default function OrderBook({ asks, bids, isAdmin }: OrderBookProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const maxSize = Math.max(1, ...asks.map((l) => l.size), ...bids.map((l) => l.size));
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;
  const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : null;
  const mid = bestAsk != null && bestBid != null ? (bestAsk + bestBid) / 2 : null;

  function row(level: BookLevel, kind: "ask" | "bid") {
    const key = `${kind}:${level.price}`;
    const color = kind === "ask" ? RED : GREEN;
    const open = expanded === key;
    return (
      <div key={key}>
        <button
          onClick={() => setExpanded(open ? null : key)}
          title="Click to see who is quoting at this level"
          style={{
            display: "grid",
            gridTemplateColumns: "5rem 5rem 1fr",
            alignItems: "center",
            gap: "0.75rem",
            width: "100%",
            padding: "0.3rem 0.75rem",
            background: open ? "rgba(99,102,241,0.07)" : "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontWeight: 700, color, fontVariantNumeric: "tabular-nums", fontSize: "0.9375rem" }}>
            {level.price}
            {level.hasCreator && (
              <span title="Includes the market creator's quote" style={{ color: "#f59e0b", marginLeft: "0.25rem", fontSize: "0.75rem" }}>★</span>
            )}
          </span>
          <span style={{ color: "#e4e4ed", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
            ×{level.size}
          </span>
          <span style={{ height: "0.625rem", background: "#1a1a2e", borderRadius: "0.2rem", overflow: "hidden" }}>
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${Math.max(4, Math.round((level.size / maxSize) * 100))}%`,
                background: kind === "ask" ? "rgba(239,68,68,0.45)" : "rgba(34,197,94,0.45)",
                ...(kind === "ask" ? { marginLeft: "auto" } : {}),
              }}
            />
          </span>
        </button>
        {open && (
          <div style={{ padding: "0.25rem 0.75rem 0.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {level.entries.map((e) => (
              <div key={e.quoteId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem" }}>
                <Link href={`/players/${e.makerId}`} style={{ color: "#818cf8", textDecoration: "none" }}>
                  {e.username}
                </Link>
                {e.isCreator && <span style={{ color: "#f59e0b" }}>★ creator</span>}
                {e.isYou && <span style={{ color: "#8888a0" }}>(you)</span>}
                <span style={{ color: "#5a5a72", fontVariantNumeric: "tabular-nums" }}>×{e.size}</span>
                {isAdmin && !e.isYou && (
                  <AdminQuoteDelete quoteId={e.quoteId} makerName={e.username} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0.75rem 1rem", borderBottom: "1px solid #1a1a2e" }}>
        <p style={{ margin: 0, fontSize: "0.6875rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Order Book
        </p>
        <span style={{ fontSize: "0.6875rem", color: "#5a5a72" }}>★ = market creator · click a level for detail</span>
      </div>

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "5rem 5rem 1fr", gap: "0.75rem", padding: "0.4rem 0.75rem", fontSize: "0.625rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        <span>Price</span>
        <span>Size</span>
        <span style={{ textAlign: "right" }}>Depth</span>
      </div>

      {asks.length === 0 && bids.length === 0 ? (
        <p style={{ padding: "1.5rem 1rem", margin: 0, textAlign: "center", color: "#5a5a72", fontSize: "0.8125rem" }}>
          Empty book — post a quote or a limit order to get it started.
        </p>
      ) : (
        <div style={{ paddingBottom: "0.5rem" }}>
          {/* Asks: worst on top, best just above the spread */}
          <p style={{ margin: 0, padding: "0.2rem 0.75rem", fontSize: "0.625rem", fontWeight: 700, color: RED, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Asks (sell OVER)
          </p>
          {asks.length === 0 ? (
            <p style={{ margin: 0, padding: "0.3rem 0.75rem", fontSize: "0.75rem", color: "#5a5a72" }}>— none —</p>
          ) : (
            [...asks].reverse().map((l) => row(l, "ask"))
          )}

          {/* Spread */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.35rem 0.75rem", margin: "0.25rem 0", background: "rgba(99,102,241,0.05)", borderTop: "1px dashed #2a2a3e", borderBottom: "1px dashed #2a2a3e" }}>
            <span style={{ fontSize: "0.6875rem", color: "#818cf8", fontWeight: 700 }}>
              {spread != null ? `spread ${spread} · mid ${mid}` : "no two-sided market yet"}
            </span>
          </div>

          {/* Bids: best at top under the spread */}
          {bids.length === 0 ? (
            <p style={{ margin: 0, padding: "0.3rem 0.75rem", fontSize: "0.75rem", color: "#5a5a72" }}>— none —</p>
          ) : (
            bids.map((l) => row(l, "bid"))
          )}
          <p style={{ margin: 0, padding: "0.2rem 0.75rem", fontSize: "0.625rem", fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Bids (buy OVER)
          </p>
        </div>
      )}
    </div>
  );
}
