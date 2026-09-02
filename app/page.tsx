import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import Navbar from "@/app/components/Navbar";
import ContractCard from "@/app/components/ContractCard";
import MarketsLiveRefresher from "@/app/components/MarketsLiveRefresher";
import GuestBanner from "@/app/components/GuestBanner";
import RecentFills, { type Fill } from "@/app/components/RecentFills";
import ActivePositionsWidget from "@/app/components/ActivePositionsWidget";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Readable without an account: a visitor should see the markets before
  // being asked for credentials. Interactive pieces are gated on `user`.
  const user = await getLabUser();

  const [contracts, settledContracts, recentTrades] = await Promise.all([
    prisma.contract.findMany({
      where: { status: "OPEN" },
      include: {
        quotes: {
          where: { status: "OPEN" },
          select: { id: true, status: true },
        },
        _count: { select: { trades: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Settled markets are the only place the settlement engine is visible from
    // outside: a closing value, and P&L realized against it on every position.
    // Hiding them behind a status filter left that half of the system unproven.
    prisma.contract.findMany({
      where: { status: "SETTLED" },
      include: {
        quotes: { where: { status: "OPEN" }, select: { id: true, status: true } },
        _count: { select: { trades: true } },
      },
      orderBy: [{ settledAt: "desc" }, { updatedAt: "desc" }],
      take: 3,
    }),
    // The tape across every market, for the ticker.
    prisma.trade.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        contractId: true,
        takerSide: true,
        strike: true,
        size: true,
        createdAt: true,
        contract: { select: { title: true } },
      },
    }),
  ]);

  const fills: Fill[] = recentTrades.map((t) => ({
    id: `t${t.id}`,
    contractId: t.contractId,
    title: t.contract.title,
    side: t.takerSide as "OVER" | "UNDER",
    strike: t.strike,
    size: t.size,
    at: t.createdAt.toISOString(),
  }));
  // Lets the ticker name a market for a fill that arrives over the socket,
  // where the payload deliberately carries ids rather than text.
  const titles: Record<number, string> = {};
  for (const c of [...contracts, ...settledContracts]) titles[c.id] = c.title;
  for (const t of recentTrades) titles[t.contractId] = t.contract.title;

  // Any authenticated user can create their own market.
  const canCreateMarket = !!user;

  return (
    <>
      <Navbar />
      <MarketsLiveRefresher authed={!!user} />
      {!user && <GuestBanner />}
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        {user && <ActivePositionsWidget userId={Number(user.id)} />}

        <RecentFills initial={fills} titles={titles} authed={!!user} />

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "2rem",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                color: "#e4e4ed",
                margin: "0 0 0.25rem",
              }}
            >
              Open Markets
            </h1>
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "#8888a0" }}>
              {contracts.length === 0
                ? "No markets open yet."
                : `${contracts.length} active ${contracts.length === 1 ? "market" : "markets"}`}
            </p>
          </div>
          {canCreateMarket && (
            <Link
              href="/markets/create"
              style={{
                padding: "0.5rem 1.25rem",
                background: "#6366f1",
                color: "#fff",
                borderRadius: "0.375rem",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              + New Contract
            </Link>
          )}
        </div>

        {/* Contracts grid */}
        {contracts.length === 0 ? (
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
              {canCreateMarket
                ? "No contracts yet. Create the first one to get started."
                : "No markets open yet. Check back soon."}
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {contracts.map((c: (typeof contracts)[number]) => (
              <ContractCard key={c.id} contract={c} />
            ))}
          </div>
        )}

        {settledContracts.length > 0 && (
          <section style={{ marginTop: "3rem" }}>
            <h2
              style={{
                fontSize: "1.125rem",
                fontWeight: 700,
                color: "#e4e4ed",
                margin: "0 0 0.25rem",
              }}
            >
              Recently settled
            </h2>
            <p style={{ margin: "0 0 1.25rem", fontSize: "0.9375rem", color: "#8888a0" }}>
              Closed at a published value, with every open position marked
              against it in one transaction — P&amp;L per trade, balances and
              ledger entries all written together or not at all.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: "1.25rem",
              }}
            >
              {settledContracts.map((c: (typeof settledContracts)[number]) => (
                <ContractCard key={c.id} contract={c} />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
