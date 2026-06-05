"use client";

// PriceChart — live market chart for a contract. Two variants:
//   • "mid" (default): the quoted market price (stepped mid of best bid/ask)
//     as a line, with executed trades overlaid as dots at their strike.
//   • "transaction": the executed-trade price itself — a stepped line that
//     carries the last traded price forward, with a dot at each trade. No mid.
// Loads history via REST, then updates live over Socket.IO (PRICE_UPDATED for the
// mid line, TRADE_EXECUTED for new trade dots). uPlot renders (small canvas lib),
// imported lazily inside the effect so it never runs during SSR.

import "uplot/dist/uPlot.min.css";
import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket-client";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

type Variant = "mid" | "transaction";

interface Props {
  contractId: number;
  minPrice: number;
  maxPrice: number;
  variant?: Variant;
}

type MidPoint = { t: number; mid: number };
type TradePoint = { t: number; price: number };

// "mid" variant — merge the mid timeline and the trades into uPlot's shared-x
// format [xs, midYs, tradeYs]:
//   - midYs carries the last mid forward at every x → a continuous stepped line.
//   - tradeYs holds the strike only at trade times (null elsewhere) → dots only.
function buildMidSeries(
  mids: MidPoint[],
  trades: TradePoint[]
): [number[], (number | null)[], (number | null)[]] {
  const byT = new Map<number, { mid: number | null; trade: number | null }>();
  const at = (t: number) => {
    let e = byT.get(t);
    if (!e) {
      e = { mid: null, trade: null };
      byT.set(t, e);
    }
    return e;
  };
  for (const p of mids) at(p.t).mid = p.mid;
  for (const tr of trades) at(tr.t).trade = tr.price;

  const ts = [...byT.keys()].sort((a, b) => a - b);
  const xs: number[] = [];
  const midYs: (number | null)[] = [];
  const tradeYs: (number | null)[] = [];
  let cur: number | null = null;
  for (const t of ts) {
    const e = byT.get(t)!;
    if (e.mid != null) cur = e.mid;
    xs.push(t);
    midYs.push(cur);
    tradeYs.push(e.trade);
  }
  return [xs, midYs, tradeYs];
}

// "transaction" variant — the executed-trade price as a stepped line plus a dot
// at each trade, both drawn from the same y column: [xs, priceYs, priceYs].
// Trades within the same second collapse to the last price so x stays unique
// and strictly ascending (uPlot requires it).
function buildTradeSeries(
  trades: TradePoint[]
): [number[], (number | null)[], (number | null)[]] {
  const byT = new Map<number, number>();
  for (const tr of trades) byT.set(tr.t, tr.price);
  const xs = [...byT.keys()].sort((a, b) => a - b);
  const ys = xs.map((t) => byT.get(t)!);
  return [xs, ys, ys];
}

export default function PriceChart({ contractId, minPrice, maxPrice, variant = "mid" }: Props) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;
    let cleanup = () => {};

    (async () => {
      const uPlot = (await import("uplot")).default;
      if (destroyed || !elRef.current) return;

      const mids: MidPoint[] = [];
      const trades: TradePoint[] = [];

      // Initial history
      try {
        const res = await fetch(
          withTradingBasePath(`/api/contracts/${contractId}/price-history`)
        );
        if (res.ok) {
          const data = await res.json();
          for (const p of data.points ?? []) mids.push({ t: p.t, mid: p.mid });
          for (const tr of data.trades ?? []) trades.push({ t: tr.t, price: tr.price });
        }
      } catch {
        // ignore — chart just starts empty
      }
      if (destroyed || !elRef.current) return;

      const buildSeries = () =>
        variant === "transaction"
          ? buildTradeSeries(trades)
          : buildMidSeries(mids, trades);

      // Per-variant data series (axis/scale config is shared below).
      const dataSeries =
        variant === "transaction"
          ? [
              {},
              {
                label: "Last",
                stroke: "#f59e0b",
                width: 2,
                // Last traded price holds flat then jumps — stepped is accurate.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                paths: (uPlot.paths.stepped as any)({ align: 1 }),
                points: { show: false },
              },
              {
                label: "Trade",
                stroke: "#f59e0b",
                // A dot at each executed trade, on top of the stepped line.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                paths: (() => null) as any,
                points: { show: true, size: 8 },
              },
            ]
          : [
              {},
              {
                label: "Mid",
                stroke: "#818cf8",
                width: 2,
                // Price holds flat then jumps at each change — stepped is accurate.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                paths: (uPlot.paths.stepped as any)({ align: 1 }),
                points: { show: false },
              },
              {
                label: "Trade",
                stroke: "#f59e0b",
                // Dots only (no connecting line) — each dot is one executed trade.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                paths: (() => null) as any,
                points: { show: true, size: 8 },
              },
            ];

      const opts = {
        width: elRef.current.clientWidth || 600,
        height: 220,
        scales: {
          y: {
            // Auto-fit the visible data (mid line + trade dots) with padding so
            // movement fills the chart instead of being cramped into the full
            // price band. A minimum span keeps a flat market from over-zooming;
            // the result is clamped to the contract's [minPrice, maxPrice].
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            range: (_u: any, dataMin: number | null, dataMax: number | null) => {
              if (dataMin == null || dataMax == null) {
                return [minPrice, maxPrice] as [number, number];
              }
              const center = (dataMin + dataMax) / 2;
              const half = Math.max((dataMax - dataMin) / 2, 5) * 1.25;
              const lo = Math.max(minPrice, Math.floor(center - half));
              const hi = Math.min(maxPrice, Math.ceil(center + half));
              return [lo, hi] as [number, number];
            },
          },
        },
        series: dataSeries,
        axes: [
          { stroke: "#5a5a72", grid: { stroke: "#1a1a2e", width: 1 }, ticks: { stroke: "#1a1a2e" } },
          { stroke: "#5a5a72", grid: { stroke: "#1a1a2e", width: 1 }, ticks: { stroke: "#1a1a2e" } },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chart = new uPlot(opts as any, buildSeries() as any, elRef.current);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refresh = () => chart.setData(buildSeries() as any);

      const onResize = () => {
        if (elRef.current) chart.setSize({ width: elRef.current.clientWidth, height: 220 });
      };
      window.addEventListener("resize", onResize);

      const socket = getSocket();
      const onPrice = (ev: { contractId: number; ts: string; mid: number }) => {
        if (ev.contractId !== contractId) return;
        // The transaction-price chart ignores the mid timeline entirely.
        if (variant === "transaction") return;
        mids.push({ t: Math.floor(new Date(ev.ts).getTime() / 1000), mid: ev.mid });
        refresh();
      };
      const onTrade = (ev: { contractId: number; strike: number }) => {
        if (ev.contractId !== contractId) return;
        trades.push({ t: Math.floor(Date.now() / 1000), price: ev.strike });
        refresh();
      };
      socket.on("PRICE_UPDATED", onPrice);
      socket.on("TRADE_EXECUTED", onTrade);

      cleanup = () => {
        window.removeEventListener("resize", onResize);
        socket.off("PRICE_UPDATED", onPrice);
        socket.off("TRADE_EXECUTED", onTrade);
        chart.destroy();
      };
    })();

    return () => {
      destroyed = true;
      cleanup();
    };
  }, [contractId, minPrice, maxPrice, variant]);

  return (
    <div>
      <div ref={elRef} style={{ width: "100%" }} />
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.6875rem", color: "#5a5a72" }}>
        {variant === "transaction" ? (
          <>
            <span style={{ color: "#f59e0b" }}>━ Last</span> (actual execution price, held until the next trade) ·{" "}
            <span style={{ color: "#f59e0b" }}>● Trade</span>
          </>
        ) : (
          <>
            <span style={{ color: "#818cf8" }}>━ Mid</span> (bid/ask reference price) ·{" "}
            <span style={{ color: "#f59e0b" }}>● Trade</span> (actual execution price)
          </>
        )}
      </p>
    </div>
  );
}
