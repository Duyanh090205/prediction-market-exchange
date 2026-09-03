"use client";

// The tape, on the landing page.
//
// Liveness a visitor can see in the first second without opening anything: the
// most recent fills across every market, with a new one flashing in as it
// prints. Fills arrive on whichever feed the viewer is on — the public
// /market-data namespace for a signed-out visitor — and are prepended locally
// so the row appears immediately, with a debounced router.refresh() behind it
// to reconcile against the server.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getMarketDataSocket } from "@/lib/socket-client";
import { sideColor } from "@/lib/theme";

export interface Fill {
  id: string;
  contractId: number;
  title: string;
  side: "OVER" | "UNDER";
  strike: number;
  size: number;
  at: string; // ISO
  fresh?: boolean;
}

const MAX = 8;

export default function RecentFills({
  initial,
  titles,
  authed,
}: {
  initial: Fill[];
  titles: Record<number, string>;
  authed: boolean;
}) {
  const router = useRouter();
  const [fills, setFills] = useState<Fill[]>(initial);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server-rendered rows are the source of truth; adopt them on every refresh.
  useEffect(() => setFills(initial), [initial]);

  useEffect(() => {
    const socket = getMarketDataSocket(authed);
    const onTrade = (ev: {
      tradeId: number;
      contractId: number;
      takerSide: "OVER" | "UNDER";
      strike: number;
      size: number;
    }) => {
      setFills((prev) => {
        if (prev.some((f) => f.id === `t${ev.tradeId}`)) return prev;
        const row: Fill = {
          id: `t${ev.tradeId}`,
          contractId: ev.contractId,
          title: titles[ev.contractId] ?? `Market ${ev.contractId}`,
          side: ev.takerSide,
          strike: ev.strike,
          size: ev.size,
          at: new Date().toISOString(),
          fresh: true,
        };
        return [row, ...prev].slice(0, MAX);
      });
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 1500);
    };
    socket.on("TRADE_EXECUTED", onTrade);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      socket.off("TRADE_EXECUTED", onTrade);
    };
  }, [router, authed, titles]);

  if (fills.length === 0) return null;

  return (
    <div
      style={{
        background: "#12121a",
        border: "1px solid #1a1a2e",
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginBottom: "2rem",
      }}
    >
      <style>{`
        @keyframes fillFlash {
          from { background: rgba(99,102,241,0.22); }
          to   { background: transparent; }
        }
        .fillRow {
          display: grid;
          grid-template-columns: minmax(0,1fr) 4.5rem 3.5rem 3rem 5.5rem;
          gap: 0.75rem;
          align-items: center;
          padding: 0.35rem 0.5rem;
          border-radius: 0.25rem;
          text-decoration: none;
          font-size: 0.8125rem;
        }
        .fillRow .fillTitle {
          color: #8888a0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fillRow .fillAgo { color: #5a5a72; font-size: 0.75rem; text-align: right; }
        /* Narrow screens: the five fixed columns left nothing for the title,
           so the market name vanished and every row read "OVER 128 x4 2h ago"
           with no way to tell which market it was. Two lines instead. */
        @media (max-width: 640px) {
          .fillRow {
            grid-template-columns: 1fr 3.5rem 3rem 5rem;
            grid-template-areas:
              "title title title title"
              "side  strike size  ago";
            row-gap: 0.15rem;
            padding: 0.45rem 0.5rem;
          }
          .fillRow .fillTitle { grid-area: title; white-space: normal; }
          .fillRow .fillSide   { grid-area: side; }
          .fillRow .fillStrike { grid-area: strike; }
          .fillRow .fillSize   { grid-area: size; }
          .fillRow .fillAgo    { grid-area: ago; }
        }
      `}</style>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 700,
          color: "#5a5a72",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: "0 0 0.75rem",
        }}
      >
        Recent fills
      </p>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {fills.map((f) => {
          const c = sideColor(f.side);
          return (
            <Link
              key={f.id}
              href={`/markets/${f.contractId}`}
              className="fillRow"
              style={{ animation: f.fresh ? "fillFlash 1.6s ease-out" : undefined }}
            >
              <span className="fillTitle">{f.title}</span>
              <span className="fillSide" style={{ color: c.fg, fontWeight: 700 }}>
                {f.side}
              </span>
              <span
                className="fillStrike"
                style={{ color: "#818cf8", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
              >
                {f.strike}
              </span>
              <span className="fillSize" style={{ color: "#e4e4ed", fontVariantNumeric: "tabular-nums" }}>
                ×{f.size}
              </span>
              <span className="fillAgo">
                <Ago iso={f.at} />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Relative time, computed after mount only: rendering "3m ago" on the server
// and again in the browser a second later is a hydration mismatch.
function Ago({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string>("");
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      setLabel(
        s < 60 ? `${s}s ago`
          : s < 3600 ? `${Math.floor(s / 60)}m ago`
          : s < 86400 ? `${Math.floor(s / 3600)}h ago`
          : `${Math.floor(s / 86400)}d ago`
      );
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [iso]);
  return <>{label}</>;
}
