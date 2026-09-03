import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Navbar from "@/app/components/Navbar";
import GuestBanner from "@/app/components/GuestBanner";
import { getLabUser } from "@/lib/labAuth";
import { contractDay } from "@/lib/formatDate";

// The settlement record.
//
// Everything else on this deployment shows a market being traded. This is the
// only page that shows one being closed: the value it settled at, when, and how
// many coins actually changed hands as a result. Public, like the market pages —
// a settled market has no book left to protect and it is the clearest evidence
// that the engine does the last step too.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settled markets",
  description:
    "Markets that have closed, the value each settled at, and the P&L that moved through the ledger.",
};

export default async function SettledPage() {
  const user = await getLabUser();

  const contracts = await prisma.contract.findMany({
    where: { status: "SETTLED" },
    include: {
      trades: { select: { size: true, takerPnl: true, takerId: true, makerId: true } },
      _count: { select: { trades: true } },
    },
    orderBy: [{ settledAt: "desc" }, { updatedAt: "desc" }],
  });

  const rows = contracts.map((c) => {
    // Every trade is two sides of the same number, so the coins that changed
    // hands is the sum of one side's magnitude. On a binary spread bet that
    // equals the size traded except where the settlement landed exactly on a
    // strike and the trade pushed — which is why the two are reported together
    // only in the totals, and the per-market row shows pushes instead.
    const moved = c.trades.reduce((s, t) => s + Math.abs(t.takerPnl ?? 0), 0);
    const volume = c.trades.reduce((s, t) => s + t.size, 0);
    const pushes = c.trades.filter((t) => t.takerPnl === 0).length;
    const players = new Set<number>();
    for (const t of c.trades) {
      players.add(t.takerId);
      players.add(t.makerId);
    }
    return { c, moved, volume, pushes, players: players.size };
  });

  const totalMoved = rows.reduce((s, r) => s + r.moved, 0);
  const totalTrades = rows.reduce((s, r) => s + r.c._count.trades, 0);
  // One entry per side of every settled trade — the audit trail the balances
  // were moved through.
  const ledgerEntries = await prisma.balanceLedger.count({
    where: { eventType: "SETTLEMENT", contractId: { in: contracts.map((c) => c.id) } },
  });

  const label: React.CSSProperties = {
    fontSize: "0.6875rem",
    color: "#5a5a72",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    margin: "0 0 0.2rem",
  };

  return (
    <>
      <Navbar />
      {!user && <GuestBanner />}
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <Link href="/" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none" }}>
            ← Markets
          </Link>
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e4e4ed", margin: "0 0 0.25rem" }}>
          Settled markets
        </h1>
        <p style={{ margin: "0 0 2rem", fontSize: "0.9375rem", color: "#8888a0", lineHeight: 1.6, maxWidth: "46rem" }}>
          A market closes at a published value. Every open position is marked
          against it in one transaction — the P&amp;L on each trade, both
          players&apos; balances, and a ledger entry for every movement, written
          together or not at all. The transaction re-checks that each affected
          balance still equals the sum of that player&apos;s ledger before it
          commits, and aborts the whole settlement if it does not.
        </p>

        {rows.length === 0 ? (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              background: "#12121a",
              border: "1px dashed #2a2a3e",
              borderRadius: "0.75rem",
            }}
          >
            <p style={{ color: "#5a5a72", fontSize: "1rem", margin: 0 }}>
              No market has settled yet.
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                gap: "2.5rem",
                flexWrap: "wrap",
                padding: "1.25rem 1.5rem",
                background: "#12121a",
                border: "1px solid #1a1a2e",
                borderRadius: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              <div>
                <p style={label}>Markets closed</p>
                <p style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "#e4e4ed" }}>
                  {rows.length}
                </p>
              </div>
              <div>
                <p style={label}>Positions marked</p>
                <p style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "#e4e4ed" }}>
                  {totalTrades}
                </p>
              </div>
              <div>
                <p style={label}>Coins moved at settlement</p>
                <p style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "#f59e0b" }}>
                  {totalMoved.toLocaleString("en-US")}
                </p>
              </div>
              <div>
                <p style={label}>Ledger entries written</p>
                <p style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "#e4e4ed" }}>
                  {ledgerEntries.toLocaleString("en-US")}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {rows.map(({ c, volume, pushes, players }) => (
                <Link
                  key={c.id}
                  href={`/markets/${c.id}`}
                  style={{
                    display: "block",
                    padding: "1.25rem 1.5rem",
                    background: "#12121a",
                    border: "1px solid #1a1a2e",
                    borderRadius: "0.75rem",
                    textDecoration: "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "1rem",
                      flexWrap: "wrap",
                      marginBottom: "0.6rem",
                    }}
                  >
                    <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 600, color: "#e4e4ed" }}>
                      {c.title}
                    </h2>
                    <span style={{ fontSize: "0.8125rem", color: "#5a5a72", whiteSpace: "nowrap" }}>
                      {contractDay(c.settledAt ?? c.updatedAt)}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                    <div>
                      <p style={label}>Settled at</p>
                      <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "#f59e0b", fontVariantNumeric: "tabular-nums" }}>
                        {c.settlementValue}
                      </p>
                    </div>
                    <div>
                      <p style={label}>Band</p>
                      <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#818cf8", fontVariantNumeric: "tabular-nums" }}>
                        {c.minPrice}–{c.maxPrice}
                      </p>
                    </div>
                    <div>
                      <p style={label}>Trades</p>
                      <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#e4e4ed", fontVariantNumeric: "tabular-nums" }}>
                        {c._count.trades}
                      </p>
                    </div>
                    <div>
                      <p style={label}>Contracts traded</p>
                      <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#e4e4ed", fontVariantNumeric: "tabular-nums" }}>
                        {volume}
                      </p>
                    </div>
                    <div>
                      <p style={label}>Players settled</p>
                      <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#e4e4ed", fontVariantNumeric: "tabular-nums" }}>
                        {players}
                      </p>
                    </div>
                    <div>
                      <p style={label}>Pushed</p>
                      <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: pushes > 0 ? "#8888a0" : "#5a5a72", fontVariantNumeric: "tabular-nums" }}>
                        {pushes}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
