"use client";

// PriceChart — live "moving mid" line for a contract.
// Loads history via REST, then appends incremental points pushed over
// Socket.IO (PRICE_UPDATED). uPlot is the renderer (small, fast canvas);
// imported lazily inside the effect so it never runs during SSR.

import "uplot/dist/uPlot.min.css";
import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket-client";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface Props {
  contractId: number;
  minPrice: number;
  maxPrice: number;
}

export default function PriceChart({ contractId, minPrice, maxPrice }: Props) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;
    let cleanup = () => {};

    (async () => {
      const uPlot = (await import("uplot")).default;
      if (destroyed || !elRef.current) return;

      const xs: number[] = [];
      const ys: number[] = [];

      // Initial history
      try {
        const res = await fetch(
          withTradingBasePath(`/api/contracts/${contractId}/price-history`)
        );
        if (res.ok) {
          const data = await res.json();
          for (const p of data.points ?? []) {
            xs.push(p.t);
            ys.push(p.mid);
          }
        }
      } catch {
        // ignore — chart just starts empty
      }
      if (destroyed || !elRef.current) return;

      const opts = {
        width: elRef.current.clientWidth || 600,
        height: 220,
        scales: { y: { range: [minPrice, maxPrice] as [number, number] } },
        series: [
          {},
          {
            label: "Mid",
            stroke: "#818cf8",
            width: 2,
            // Price holds flat then JUMPS at each event — stepped is the
            // accurate shape (not a gradual diagonal slide). align:1 = the new
            // value holds forward until the next change. Dots mark real events.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            paths: (uPlot.paths.stepped as any)({ align: 1 }),
            points: { show: true, size: 6 },
          },
        ],
        axes: [
          { stroke: "#5a5a72", grid: { stroke: "#1a1a2e", width: 1 }, ticks: { stroke: "#1a1a2e" } },
          { stroke: "#5a5a72", grid: { stroke: "#1a1a2e", width: 1 }, ticks: { stroke: "#1a1a2e" } },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chart = new uPlot(opts as any, [xs, ys] as any, elRef.current);

      const onResize = () => {
        if (elRef.current) chart.setSize({ width: elRef.current.clientWidth, height: 220 });
      };
      window.addEventListener("resize", onResize);

      const socket = getSocket();
      const onPrice = (ev: { contractId: number; ts: string; mid: number }) => {
        if (ev.contractId !== contractId) return;
        xs.push(Math.floor(new Date(ev.ts).getTime() / 1000));
        ys.push(ev.mid);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chart.setData([xs, ys] as any);
      };
      socket.on("PRICE_UPDATED", onPrice);

      cleanup = () => {
        window.removeEventListener("resize", onResize);
        socket.off("PRICE_UPDATED", onPrice);
        chart.destroy();
      };
    })();

    return () => {
      destroyed = true;
      cleanup();
    };
  }, [contractId, minPrice, maxPrice]);

  return (
    <div>
      <div ref={elRef} style={{ width: "100%" }} />
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.6875rem", color: "#5a5a72" }}>
        Đường giá tham chiếu (mid của bid/ask) — không phải giá khớp lệnh.
      </p>
    </div>
  );
}
