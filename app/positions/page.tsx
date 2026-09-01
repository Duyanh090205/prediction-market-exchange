import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import { sideColor } from "@/lib/theme";

export default async function PositionsPage() {
  const user = await getLabUser();
  if (!user) redirect("/login");

  const userId = Number(user.id);

  const trades = await prisma.trade.findMany({
    where: {
      status: { in: ["OPEN", "SETTLED"] },
      OR: [{ takerId: userId }, { makerId: userId }],
    },
    include: {
      contract: { select: { id: true, title: true, settlementValue: true } },
      taker: { select: { id: true, username: true } },
      maker: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const openTrades = trades.filter((t) => t.status === "OPEN");
  const settledTrades = trades.filter((t) => t.status === "SETTLED");

  return (
    <>
      <Navbar />
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <Link href="/" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
          ← Markets
        </Link>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "#e4e4ed",
            marginBottom: "0.25rem",
          }}
        >
          My Positions
        </h1>
        <p style={{ color: "#5a5a72", fontSize: "0.875rem", marginBottom: "2rem" }}>
          Open trades and settled history across all contracts
        </p>

        {/* ── Open positions ── */}
        <h2 style={{ fontSize: "0.75rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 1rem" }}>
          Open ({openTrades.length})
        </h2>

        {openTrades.length === 0 ? (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              background: "#12121a",
              border: "1px dashed #2a2a3e",
              borderRadius: "0.75rem",
              color: "#5a5a72",
            }}
          >
            No open positions yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {openTrades.map((trade) => {
              const isAsTaker = trade.takerId === userId;
              const side = isAsTaker ? trade.takerSide : trade.takerSide === "OVER" ? "UNDER" : "OVER";
              const oppSide = side === "OVER" ? "UNDER" : "OVER";
              const winScenario =
                side === "OVER"
                  ? `Settlement > ${trade.strike} → +${trade.size}`
                  : `Settlement < ${trade.strike} → +${trade.size}`;
              const lossScenario =
                side === "OVER"
                  ? `Settlement < ${trade.strike} → −${trade.size}`
                  : `Settlement > ${trade.strike} → −${trade.size}`;
              const counterparty = isAsTaker ? trade.maker : trade.taker;

              return (
                <div
                  key={trade.id}
                  style={{
                    padding: "1.25rem 1.5rem",
                    background: "#12121a",
                    border: "1px solid #1a1a2e",
                    borderRadius: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <div>
                      <Link
                        href={`/markets/${trade.contract.id}`}
                        style={{
                          fontSize: "0.9375rem",
                          fontWeight: 600,
                          color: "#818cf8",
                          textDecoration: "none",
                        }}
                      >
                        {trade.contract.title}
                      </Link>
                      <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#5a5a72" }}>
                        vs {counterparty.username} ({oppSide}) · {isAsTaker ? "Taker" : "Maker"}
                      </p>
                    </div>
                    {(() => {
                      const c = sideColor(side as "OVER" | "UNDER");
                      return (
                        <span
                          style={{
                            padding: "0.25rem 0.75rem",
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            borderRadius: "9999px",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            color: c.fg,
                          }}
                        >
                          {side} {trade.strike}
                        </span>
                      );
                    })()}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                      gap: "1rem",
                    }}
                  >
                    <div>
                      <p style={{ margin: "0 0 0.25rem", fontSize: "0.6875rem", color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Size
                      </p>
                      <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#e4e4ed", fontVariantNumeric: "tabular-nums" }}>
                        {trade.size}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 0.25rem", fontSize: "0.6875rem", color: "#8888a0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Win
                      </p>
                      <p style={{ margin: 0, fontSize: "0.8125rem", color: "#8888a0" }}>
                        {winScenario}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 0.25rem", fontSize: "0.6875rem", color: "#8888a0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Loss
                      </p>
                      <p style={{ margin: 0, fontSize: "0.8125rem", color: "#8888a0" }}>
                        {lossScenario}
                      </p>
                    </div>
                  </div>
                  <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
                    Push (tie): Settlement = {trade.strike} → 0
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Settled history ── */}
        <h2 style={{ fontSize: "0.75rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", margin: "2.5rem 0 1rem" }}>
          History ({settledTrades.length})
        </h2>

        {settledTrades.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              background: "#12121a",
              border: "1px dashed #2a2a3e",
              borderRadius: "0.75rem",
              color: "#5a5a72",
              fontSize: "0.875rem",
            }}
          >
            No settled trades yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {settledTrades.map((trade) => {
              const isAsTaker = trade.takerId === userId;
              const side = isAsTaker ? trade.takerSide : trade.takerSide === "OVER" ? "UNDER" : "OVER";
              const oppSide = side === "OVER" ? "UNDER" : "OVER";
              const counterparty = isAsTaker ? trade.maker : trade.taker;
              const pnl = (isAsTaker ? trade.takerPnl : trade.makerPnl) ?? 0;
              const pnlColor = pnl > 0 ? "#10b981" : pnl < 0 ? "#ef4444" : "#8888a0";
              const c = sideColor(side as "OVER" | "UNDER");

              return (
                <div
                  key={trade.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.875rem 1.25rem",
                    background: "#12121a",
                    border: "1px solid #1a1a2e",
                    borderRadius: "0.625rem",
                  }}
                >
                  <div>
                    <Link
                      href={`/markets/${trade.contract.id}`}
                      style={{ fontSize: "0.875rem", fontWeight: 600, color: "#818cf8", textDecoration: "none" }}
                    >
                      {trade.contract.title}
                    </Link>
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
                      <span style={{ color: c.fg, fontWeight: 700 }}>{side} {trade.strike}</span>
                      {" · "}size {trade.size}
                      {" · vs "}{counterparty.username} ({oppSide})
                      {trade.contract.settlementValue != null && <> · result {trade.contract.settlementValue}</>}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontSize: "0.6875rem", color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      P&amp;L
                    </p>
                    <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: pnlColor, fontVariantNumeric: "tabular-nums" }}>
                      {pnl > 0 ? "+" : ""}{pnl.toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
