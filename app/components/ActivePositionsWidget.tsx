import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculatePnl } from "@/lib/pnl";
import { sideColor } from "@/lib/theme";

// Home-page dashboard widget (#12): a quick glance at the viewer's open
// positions plus a *tentative* P&L — what they'd realise if every market
// settled at its current price (latest recorded mid). Binary payoff, so each
// leg is ±size depending on whether the current mid is past the strike.
// Renders nothing when the user holds no open positions.
export default async function ActivePositionsWidget({ userId }: { userId: number }) {
  const openTrades = await prisma.trade.findMany({
    where: { status: "OPEN", OR: [{ takerId: userId }, { makerId: userId }] },
    include: { contract: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (openTrades.length === 0) return null;

  const contractIds = [...new Set(openTrades.map((t) => t.contractId))];
  const midRows = await prisma.$queryRaw<Array<{ contractId: number; mid: number }>>`
    SELECT DISTINCT ON ("contractId") "contractId", mid
    FROM "PricePoint"
    WHERE "contractId" IN (${Prisma.join(contractIds)})
    ORDER BY "contractId", ts DESC
  `;
  const midByContract = new Map(midRows.map((r) => [r.contractId, r.mid]));

  let totalSize = 0;
  let tentative = 0;
  let pricedCount = 0;
  const rows = openTrades.map((t) => {
    const isAsTaker = t.takerId === userId;
    const side = (isAsTaker ? t.takerSide : t.takerSide === "OVER" ? "UNDER" : "OVER") as "OVER" | "UNDER";
    totalSize += t.size;
    const mid = midByContract.get(t.contractId);
    let pnl: number | null = null;
    if (mid != null) {
      pnl = calculatePnl(side, t.strike, Math.round(mid), t.size).takerPnl;
      tentative += pnl;
      pricedCount++;
    }
    return { t, side, pnl };
  });

  const tentColor = tentative > 0 ? "#22c55e" : tentative < 0 ? "#ef4444" : "#8888a0";
  const label: React.CSSProperties = { fontSize: "0.6875rem", color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.05em" };

  return (
    <div
      style={{
        background: "#12121a",
        border: "1px solid #1a1a2e",
        borderRadius: "0.75rem",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <p style={{ ...label, fontWeight: 700, margin: 0 }}>Your Active Positions</p>
        <Link href="/positions" style={{ fontSize: "0.8125rem", color: "#818cf8", textDecoration: "none" }}>
          View all →
        </Link>
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <p style={{ ...label, margin: "0 0 0.2rem" }}>Open</p>
          <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "#e4e4ed" }}>{openTrades.length}</p>
        </div>
        <div>
          <p style={{ ...label, margin: "0 0 0.2rem" }}>Total size</p>
          <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "#e4e4ed" }}>{totalSize}</p>
        </div>
        <div>
          <p style={{ ...label, margin: "0 0 0.2rem" }}>P&amp;L if settled now</p>
          <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: tentColor, fontVariantNumeric: "tabular-nums" }}>
            {pricedCount === 0 ? "—" : `${tentative > 0 ? "+" : ""}${tentative}`}
          </p>
        </div>
      </div>

      {/* Top positions */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {rows.slice(0, 4).map(({ t, side, pnl }) => {
          const c = sideColor(side);
          return (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", fontSize: "0.8125rem" }}>
              <Link href={`/markets/${t.contract.id}`} style={{ color: "#818cf8", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.contract.title}
              </Link>
              <span style={{ display: "flex", gap: "0.6rem", alignItems: "center", whiteSpace: "nowrap" }}>
                <span style={{ color: c.fg, fontWeight: 600 }}>{side} {t.strike}</span>
                <span style={{ color: "#5a5a72" }}>×{t.size}</span>
                {pnl != null && (
                  <span style={{ color: pnl > 0 ? "#22c55e" : pnl < 0 ? "#ef4444" : "#8888a0", fontVariantNumeric: "tabular-nums", minWidth: "2.5rem", textAlign: "right" }}>
                    {pnl > 0 ? "+" : ""}{pnl}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {rows.length > 4 && (
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
            +{rows.length - 4} more
          </p>
        )}
      </div>
    </div>
  );
}
