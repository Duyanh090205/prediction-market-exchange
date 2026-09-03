"use client";

// The tape: one row per print.
//
// It used to render each trade as two rows, one per side, with the timestamp on
// the first only. At four seeded trades that read as a nice touch. At forty it
// reads as a rendering fault — eighty rows, half of them undated — and it made
// the market page ten thousand pixels tall on a phone.
//
// A real tape carries one line per print: when, which side was the aggressor,
// the price, the size. Both counterparties still appear, because on a binary
// spread contract knowing who took the other side is the interesting part; they
// are two columns rather than two rows. Realized P&L sits next to each name once
// the market has settled.
//
// Times are UTC, matching the settlement dates elsewhere, and labelled as such.

import { useState } from "react";
import Link from "next/link";
import AdminTradeDelete from "./AdminTradeDelete";
import { sideColor } from "@/lib/theme";
import { contractDateTime } from "@/lib/formatDate";

export interface TapeRow {
  id: number;
  /** Aggressor side — the one that crossed the spread. */
  takerSide: "OVER" | "UNDER";
  strike: number;
  size: number;
  at: string;
  over: { id: number; username: string; pnl: number | null };
  under: { id: number; username: string; pnl: number | null };
}

const PREVIEW = 12;

function Pnl({ value }: { value: number | null }) {
  if (value == null) return null;
  const color = value > 0 ? "#22c55e" : value < 0 ? "#ef4444" : "#8888a0";
  return (
    <span style={{ color, fontWeight: 700, marginLeft: "0.4rem", fontVariantNumeric: "tabular-nums" }}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

export default function TradeTape({
  rows,
  isSettled,
  isAdmin,
}: {
  rows: TapeRow[];
  isSettled: boolean;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, PREVIEW);
  const hidden = rows.length - shown.length;

  if (rows.length === 0) {
    return (
      <p style={{ color: "#5a5a72", fontSize: "0.875rem", margin: 0 }}>
        No confirmed trades yet.
      </p>
    );
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    fontSize: "0.6875rem",
    fontWeight: 700,
    color: "#5a5a72",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderBottom: "1px solid #1a1a2e",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "0.45rem 0.75rem",
    borderBottom: "1px solid #14141f",
    whiteSpace: "nowrap",
  };
  const nameLink: React.CSSProperties = {
    color: "inherit",
    textDecoration: "none",
    borderBottom: "1px dotted currentColor",
  };

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr>
              <th style={th}>Time (UTC)</th>
              <th style={th}>Aggressor</th>
              <th style={th}>Strike</th>
              <th style={th}>Size</th>
              <th style={th}>Over</th>
              <th style={th}>Under</th>
              {isAdmin && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const c = sideColor(t.takerSide);
              return (
                <tr key={t.id}>
                  <td style={{ ...td, color: "#5a5a72", fontSize: "0.75rem" }}>
                    {contractDateTime(t.at)}
                  </td>
                  <td style={{ ...td, color: c.fg, fontWeight: 700 }}>{t.takerSide}</td>
                  <td style={{ ...td, color: "#818cf8", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {t.strike}
                  </td>
                  <td style={{ ...td, color: "#e4e4ed", fontVariantNumeric: "tabular-nums" }}>
                    {t.size}
                  </td>
                  <td style={{ ...td, color: sideColor("OVER").fg, fontWeight: 600 }}>
                    <Link href={`/players/${t.over.id}`} style={nameLink}>
                      {t.over.username}
                    </Link>
                    {isSettled && <Pnl value={t.over.pnl} />}
                  </td>
                  <td style={{ ...td, color: sideColor("UNDER").fg, fontWeight: 600 }}>
                    <Link href={`/players/${t.under.id}`} style={nameLink}>
                      {t.under.username}
                    </Link>
                    {isSettled && <Pnl value={t.under.pnl} />}
                  </td>
                  {isAdmin && (
                    <td style={td}>
                      <AdminTradeDelete tradeId={t.id} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: "0.9rem",
            padding: "0.45rem 1rem",
            background: "transparent",
            border: "1px solid #2a2a3e",
            borderRadius: "0.375rem",
            color: "#8888a0",
            fontSize: "0.8125rem",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {expanded ? `Show the last ${PREVIEW}` : `Show all ${rows.length} trades (${hidden} more)`}
        </button>
      )}
    </>
  );
}
