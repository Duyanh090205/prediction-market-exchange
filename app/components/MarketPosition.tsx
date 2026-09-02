import { prisma } from "@/lib/prisma";
import { calculatePnl } from "@/lib/pnl";
import { worstCaseForContract } from "@/lib/margin";
import { sideColor } from "@/lib/theme";

// The viewer's position in THIS market, on the market page.
//
// The home page already summarises positions across every contract, but the
// moment worth showing is the one right after a fill: the page refreshes, and
// the size, the mark and the margin the position locks up all move on the same
// screen as the book that produced them. Without it a fill is a green toast and
// a row on a tape, and the engine behind it stays invisible.
//
// Renders nothing when the viewer holds nothing here.
export default async function MarketPosition({
  userId,
  contractId,
}: {
  userId: number;
  contractId: number;
}) {
  const trades = await prisma.trade.findMany({
    where: {
      contractId,
      status: "OPEN",
      OR: [{ takerId: userId }, { makerId: userId }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      takerId: true,
      takerSide: true,
      strike: true,
      size: true,
      createdAt: true,
    },
  });
  if (trades.length === 0) return null;

  // Each trade seen from this user's side of it.
  const legs = trades.map((t) => {
    const isAsTaker = t.takerId === userId;
    const side = (
      isAsTaker ? t.takerSide : t.takerSide === "OVER" ? "UNDER" : "OVER"
    ) as "OVER" | "UNDER";
    return { id: t.id, side, strike: t.strike, size: t.size, isAsTaker, takerSide: t.takerSide as "OVER" | "UNDER" };
  });

  const over = legs.filter((l) => l.side === "OVER").reduce((s, l) => s + l.size, 0);
  const under = legs.filter((l) => l.side === "UNDER").reduce((s, l) => s + l.size, 0);
  const totalSize = over + under;

  // Worst case across every test point — the same function the margin engine
  // uses to decide whether the next order is allowed.
  const worstCase = worstCaseForContract(
    legs.map((l) => ({
      takerSide: l.takerSide,
      strike: l.strike,
      size: l.size,
      isAsTaker: l.isAsTaker,
    }))
  );

  // Mark against the last recorded mid, when there is one. Binary payoff, so a
  // leg is worth ±size depending on which side of the strike the mid sits.
  const latest = await prisma.pricePoint.findFirst({
    where: { contractId },
    orderBy: { ts: "desc" },
    select: { mid: true },
  });
  const mid = latest ? Math.round(latest.mid) : null;
  const marked =
    mid == null
      ? null
      : legs.reduce((s, l) => s + calculatePnl(l.side, l.strike, mid, l.size).takerPnl, 0);

  const label: React.CSSProperties = {
    fontSize: "0.6875rem",
    color: "#5a5a72",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "0 0 0.2rem",
  };
  const num: React.CSSProperties = {
    margin: 0,
    fontSize: "1.125rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div
      style={{
        padding: "1.25rem",
        background: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.28)",
        borderRadius: "0.75rem",
      }}
    >
      <p style={{ ...label, fontWeight: 700, marginBottom: "0.85rem" }}>
        Your position in this market
      </p>

      <div style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
        <div>
          <p style={label}>Net</p>
          <p style={{ ...num, color: over === under ? "#8888a0" : sideColor(over > under ? "OVER" : "UNDER").fg }}>
            {over === under ? "flat" : `${Math.abs(over - under)} ${over > under ? "OVER" : "UNDER"}`}
          </p>
        </div>
        <div>
          <p style={label}>Traded</p>
          <p style={{ ...num, color: "#e4e4ed" }}>{totalSize}</p>
        </div>
        <div>
          <p style={label}>Marked{mid != null ? ` @ ${mid}` : ""}</p>
          <p
            style={{
              ...num,
              color: marked == null ? "#5a5a72" : marked > 0 ? "#22c55e" : marked < 0 ? "#ef4444" : "#8888a0",
            }}
          >
            {marked == null ? "—" : marked > 0 ? `+${marked}` : String(marked)}
          </p>
        </div>
        <div>
          <p style={label}>Margin locked</p>
          <p style={{ ...num, color: worstCase < 0 ? "#f59e0b" : "#8888a0" }}>{worstCase}</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        {legs.slice(0, 6).map((l) => {
          const c = sideColor(l.side);
          return (
            <div
              key={l.id}
              style={{
                display: "flex",
                gap: "0.6rem",
                fontSize: "0.8125rem",
                color: "#8888a0",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: c.fg, fontWeight: 700, width: "3.5rem" }}>{l.side}</span>
              <span style={{ color: "#818cf8", fontWeight: 600 }}>{l.strike}</span>
              <span>×{l.size}</span>
              <span style={{ color: "#5a5a72" }}>{l.isAsTaker ? "taker" : "maker"}</span>
            </div>
          );
        })}
        {legs.length > 6 && (
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
            + {legs.length - 6} more
          </p>
        )}
      </div>

      <p style={{ margin: "0.85rem 0 0", fontSize: "0.75rem", color: "#5a5a72", lineHeight: 1.5 }}>
        Margin locked is the worst case across every settlement value, from the
        same function that decides whether your next order is allowed.
      </p>
    </div>
  );
}
