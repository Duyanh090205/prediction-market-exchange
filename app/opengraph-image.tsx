import { ImageResponse } from "next/og";

// The card that appears when this link is pasted into Slack, LinkedIn or a
// message — which is how a portfolio link actually travels, forwarded from the
// person who received it to the desk that will look at it. Without one it
// arrives as a grey rectangle.
//
// Drawn rather than screenshotted so it cannot go stale: it says what the thing
// is, and shows a book because that is the first thing on the page.
export const alt = "Prediction-Market Exchange — a central limit order book, margin engine and atomic settlement";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BIDS: Array<[number, number]> = [
  [96, 40],
  [92, 34],
  [88, 28],
  [84, 24],
];
const ASKS: Array<[number, number]> = [
  [104, 38],
  [108, 34],
  [112, 28],
  [116, 24],
];

function Ladder({
  rows,
  color,
  label,
  align,
}: {
  rows: Array<[number, number]>;
  color: string;
  label: string;
  align: "flex-start" | "flex-end";
}) {
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 250 }}>
      <div
        style={{
          display: "flex",
          fontSize: 18,
          letterSpacing: 2,
          color: "#5a5a72",
          justifyContent: align,
        }}
      >
        {label}
      </div>
      {rows.map(([price, sizeUnits]) => (
        <div
          key={price}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: align,
            gap: 12,
            height: 34,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              [align === "flex-end" ? "right" : "left"]: 0,
              width: `${(sizeUnits / max) * 100}%`,
              background: color,
              opacity: 0.16,
              borderRadius: 4,
            }}
          />
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color }}>{price}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#8888a0" }}>{sizeUnits}</div>
        </div>
      ))}
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0b12",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 700, color: "#e4e4ed" }}>
            Prediction-Market Exchange
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#8888a0", maxWidth: 900 }}>
            A central limit order book with price-time priority, a margin engine
            that reserves against worst-case loss, and atomic settlement.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 40 }}>
            <Ladder rows={BIDS} color="#22c55e" label="BUY UNDER" align="flex-start" />
            <Ladder rows={ASKS} color="#ef4444" label="BUY OVER" align="flex-start" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 24, color: "#818cf8" }}>
              Next.js · PostgreSQL · Socket.IO
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#5a5a72" }}>
              readable without an account
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
