import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import { sideColor } from "@/lib/theme";

export default async function PositionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = Number(session.user.id);

  const trades = await prisma.trade.findMany({
    where: {
      status: "OPEN",
      OR: [{ takerId: userId }, { makerId: userId }],
    },
    include: {
      contract: { select: { id: true, title: true } },
      taker: { select: { id: true, username: true } },
      maker: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

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
          Open trades across all contracts
        </p>

        {trades.length === 0 ? (
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
            {trades.map((trade) => {
              const isAsTaker = trade.takerId === userId;
              const side = isAsTaker ? trade.takerSide : trade.takerSide === "OVER" ? "UNDER" : "OVER";
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
                        vs {counterparty.username} · {isAsTaker ? "Taker" : "Maker"}
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
                      gridTemplateColumns: "repeat(3, 1fr)",
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
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
