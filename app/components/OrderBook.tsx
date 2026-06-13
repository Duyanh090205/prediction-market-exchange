"use client";

// Unified order book (Sam #1) — Kalshi-style two parallel columns ("Buy OVER" |
// "Buy UNDER"), each sorted BEST PRICE FIRST, with a Polymarket-style explicit
// cumulative "Total" column and a depth fill behind each row. Research showed
// this beats the classic center-spread ladder for first-time traders: both
// lists read naturally top-down, and the cumulative number is visible instead
// of hover-only. All open quotes (creator + players + resting limit orders)
// are aggregated by price level; like a real exchange the rows are anonymous —
// click a row to see who is quoting there.

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
  entries: BookEntry[];
}

interface OrderBookProps {
  /** Sorted best-first: asks ascending, bids descending. */
  asks: BookLevel[];
  bids: BookLevel[];
  isAdmin: boolean;
  /** Contract price band — the valid price range for quotes/orders. */
  minPrice: number;
  maxPrice: number;
}

const GREEN = "#22c55e";
const RED = "#ef4444";

export default function OrderBook({ asks, bids, isAdmin, minPrice, maxPrice }: OrderBookProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Objective top-of-book, exactly as real exchanges show it: best bid/ask
  // include every resting quote — your own too. Self-trade prevention is an
  // execution concern (your order skips your own quotes; see the "you" badge +
  // help note), not a reason to personalise the displayed spread.
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;
  const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : null;
  // Crossed/locked book guard: bid ≥ ask shouldn't rest (crossing quotes
  // auto-match), but a margin-blocked match can leave one — show it, don't
  // render a meaningless "spread 0" or negative number.
  const crossed = spread != null && spread <= 0;
  const mid = bestAsk != null && bestBid != null ? (bestAsk + bestBid) / 2 : null;

  // Cumulative totals (Polymarket-style "Total" column): row i = everything
  // available from the best price through that level.
  const cumAsks: number[] = [];
  asks.reduce((acc, l, i) => (cumAsks[i] = acc + l.size), 0);
  const cumBids: number[] = [];
  bids.reduce((acc, l, i) => (cumBids[i] = acc + l.size), 0);
  const askTotal = cumAsks[cumAsks.length - 1] ?? 0;
  const bidTotal = cumBids[cumBids.length - 1] ?? 0;
  // Shared depth scale across BOTH sides so the bar lengths are comparable: the
  // heavier side reads visibly fuller, surfacing buy/sell imbalance at a glance.
  // (Per-side scaling made every column's last row ~100% and hid the asymmetry.)
  const depthScale = Math.max(askTotal, bidTotal, 1);
  // Liquidity split — round one side and derive the other as its complement so
  // the two percentages always sum to exactly 100 (no 69% + 32% = 101% drift).
  const liqTotal = bidTotal + askTotal;
  const underPct = liqTotal > 0 ? Math.round((bidTotal / liqTotal) * 100) : 0;
  const overPct = 100 - underPct;

  function column(
    title: string,
    color: string,
    rgba: string,
    levels: BookLevel[],
    cums: number[],
    kind: "ask" | "bid"
  ) {
    return (
      <div style={{ minWidth: 0 }}>
        {/* Column title */}
        <p
          style={{
            margin: 0,
            padding: "0.5rem 0.75rem",
            fontSize: "0.6875rem",
            fontWeight: 700,
            color,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            borderBottom: "1px solid #1a1a2e",
          }}
        >
          {title}
        </p>

        {/* Column headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0.5rem",
            padding: "0.35rem 0.75rem",
            fontSize: "0.5625rem",
            fontWeight: 700,
            color: "#5a5a72",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          <span>Price</span>
          <span style={{ textAlign: "right" }}>Size</span>
          <span style={{ textAlign: "right" }}>Total</span>
        </div>

        {levels.length === 0 ? (
          <p style={{ margin: 0, padding: "0.75rem", fontSize: "0.75rem", color: "#5a5a72", textAlign: "center" }}>
            — no offers yet —
          </p>
        ) : (
          levels.map((level, i) => {
            const key = `${kind}:${level.price}`;
            const open = expanded === key;
            const cum = cums[i];
            const fillPct = Math.max(4, Math.round((cum / depthScale) * 100));
            return (
              <div key={key}>
                <button
                  onClick={() => setExpanded(open ? null : key)}
                  title={`Total available down to ${level.price}: ${cum} — click to see who is quoting`}
                  style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: "0.5rem",
                    alignItems: "center",
                    width: "100%",
                    padding: "0.35rem 0.75rem",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    overflow: "hidden",
                  }}
                >
                  {/* Depth fill behind the row (cumulative size on the shared scale) */}
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      right: 0,
                      width: `${fillPct}%`,
                      background: rgba,
                      opacity: open ? 0.5 : 0.28,
                    }}
                  />
                  <span style={{ position: "relative", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", fontSize: "0.9375rem" }}>
                    {level.price}
                    {i === 0 && (
                      <span style={{ marginLeft: "0.3rem", fontSize: "0.5625rem", fontWeight: 700, color: "#818cf8" }}>BEST</span>
                    )}
                    {level.entries.some((e) => e.isYou) && (
                      <span
                        title="Includes YOUR quote — your own orders skip it (you can't trade with yourself)"
                        style={{
                          marginLeft: "0.3rem",
                          fontSize: "0.5625rem",
                          fontWeight: 700,
                          color: "#8888a0",
                          border: "1px solid #3a3a5e",
                          borderRadius: "0.2rem",
                          padding: "0.05rem 0.25rem",
                          textTransform: "uppercase",
                        }}
                      >
                        you
                      </span>
                    )}
                  </span>
                  <span style={{ position: "relative", textAlign: "right", color: "#e4e4ed", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {level.size}
                  </span>
                  <span style={{ position: "relative", textAlign: "right", color: "#8888a0", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {cum}
                  </span>
                </button>
                {open && (
                  <div style={{ padding: "0.25rem 0.75rem 0.5rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.2rem", borderBottom: "1px solid #1a1a2e" }}>
                    {level.entries.map((e) => (
                      <div key={e.quoteId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem" }}>
                        <Link href={`/players/${e.makerId}`} style={{ color: "#818cf8", textDecoration: "none" }}>
                          {e.username}
                        </Link>
                        {e.isCreator && <span style={{ color: "#f59e0b" }}>creator</span>}
                        {e.isYou && <span style={{ color: "#8888a0" }}>(you)</span>}
                        <span style={{ color: "#5a5a72", fontVariantNumeric: "tabular-nums" }}>×{e.size}</span>
                        {isAdmin && !e.isYou && <AdminQuoteDelete quoteId={e.quoteId} makerName={e.username} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div style={{ background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", borderBottom: "1px solid #1a1a2e" }}>
        <p style={{ margin: 0, fontSize: "0.6875rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Order Book
          {crossed ? (
            <span style={{ marginLeft: "0.6rem", color: "#f59e0b", textTransform: "none", letterSpacing: 0 }}>
              ⚠ crossed book
            </span>
          ) : (
            spread != null && (
              <span style={{ marginLeft: "0.6rem", color: "#818cf8", textTransform: "none", letterSpacing: 0 }}>
                spread {spread} · mid {mid}
              </span>
            )
          )}
          <span style={{ marginLeft: "0.6rem", color: "#5a5a72", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            range {minPrice}–{maxPrice}
          </span>
        </p>

        {/* "?" — plain-language explainer for first-time traders */}
        <div
          style={{ position: "relative" }}
          onMouseEnter={() => setShowHelp(true)}
          onMouseLeave={() => setShowHelp(false)}
        >
          <button
            onClick={() => setShowHelp((v) => !v)}
            aria-label="How to read the order book"
            style={{
              width: "1.25rem",
              height: "1.25rem",
              borderRadius: "9999px",
              border: "1px solid #3a3a5e",
              background: "transparent",
              color: "#818cf8",
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: "help",
              lineHeight: 1,
            }}
          >
            ?
          </button>
          {showHelp && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "1.75rem",
                width: "min(320px, 80vw)",
                padding: "0.875rem 1rem",
                background: "#1a1a2e",
                border: "1px solid #3a3a5e",
                borderRadius: "0.5rem",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                zIndex: 50,
                fontSize: "0.75rem",
                color: "#c4c4d4",
                lineHeight: 1.55,
                maxHeight: "min(70vh, 440px)",
                overflowY: "auto",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700, color: "#e4e4ed" }}>How to read this</p>
              <p style={{ margin: "0 0 0.4rem" }}>
                Two lists, best price on top of each.
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                <strong style={{ color: RED }}>Buy OVER</strong>: prices people are offering the OVER side at. The top row is the cheapest — that&apos;s what a market order pays.
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                <strong style={{ color: GREEN }}>Buy UNDER</strong>: prices for the UNDER side. The top row is the best one.
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                <strong>Size</strong> = contracts waiting at that price. <strong>Total</strong> = Size added up from the best price down to that row — “if I accept this price, how much can I get in total?”
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                <strong>Spread</strong> = gap between the two best prices; <strong>mid</strong> = its midpoint.
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                Click any row to see who is quoting there.
              </p>
              <p style={{ margin: 0 }}>
                ⚠️ <strong>You can&apos;t trade with yourself</strong> — your orders skip rows marked <strong>you</strong>. If the best price is yours, your order fills at the next level instead.
              </p>
            </div>
          )}
        </div>
      </div>

      {(bids.length > 0 || asks.length > 0) && askTotal + bidTotal > 0 && (
        <>
          {/* Liquidity balance — totals + imbalance bar; the shape at a glance */}
          <div style={{ padding: "0.6rem 1rem", borderBottom: "1px solid #1a1a2e", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <span style={{ color: GREEN }}>UNDER {bidTotal} · {underPct}%</span>
              <span style={{ color: "#5a5a72" }}>Liquidity</span>
              <span style={{ color: RED }}>{overPct}% · {askTotal} OVER</span>
            </div>
            <div style={{ display: "flex", height: "0.4rem", borderRadius: "9999px", overflow: "hidden", background: "#1a1a2e" }}>
              <span style={{ width: `${(bidTotal / (bidTotal + askTotal)) * 100}%`, background: GREEN }} />
              <span style={{ width: `${(askTotal / (bidTotal + askTotal)) * 100}%`, background: RED }} />
            </div>
          </div>
        </>
      )}

      {(asks.length === 0 && bids.length === 0) ? (
        <p style={{ padding: "1.5rem 1rem", margin: 0, textAlign: "center", color: "#5a5a72", fontSize: "0.8125rem" }}>
          Empty book — post a quote or a limit order to get it started.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 0,
            overflow: "hidden",
            borderRadius: "0 0 0.75rem 0.75rem",
          }}
        >
          {column("Buy UNDER", GREEN, "rgba(34,197,94,0.16)", bids, cumBids, "bid")}
          <div style={{ borderLeft: "1px solid #1a1a2e" }}>
            {column("Buy OVER", RED, "rgba(239,68,68,0.16)", asks, cumAsks, "ask")}
          </div>
        </div>
      )}
    </div>
  );
}
