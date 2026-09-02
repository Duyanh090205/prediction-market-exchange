import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import Navbar from "@/app/components/Navbar";
import ContractCard from "@/app/components/ContractCard";
import MarketsLiveRefresher from "@/app/components/MarketsLiveRefresher";
import ActivePositionsWidget from "@/app/components/ActivePositionsWidget";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Readable without an account: a visitor should see the markets before
  // being asked for credentials. Interactive pieces are gated on `user`.
  const user = await getLabUser();

  const contracts = await prisma.contract.findMany({
    where: { status: "OPEN" },
    include: {
      quotes: {
        where: { status: "OPEN" },
        select: { id: true, status: true },
      },
      _count: { select: { trades: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Any authenticated user can create their own market.
  const canCreateMarket = !!user;

  return (
    <>
      <Navbar />
      <MarketsLiveRefresher />
      {!user && (
        <div
          style={{
            maxWidth: "1100px",
            margin: "1rem auto 0",
            padding: "0.75rem 1.25rem",
            background: "rgba(99,102,241,0.10)",
            border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: "0.5rem",
            color: "#a5b4fc",
            fontSize: "0.875rem",
          }}
        >
          Viewing as a guest — the book, prices and fills are live and read-only.{" "}
          <a href="/login" style={{ color: "#c7d2fe" }}>Sign in</a> to place orders.
        </div>
      )}
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        {user && <ActivePositionsWidget userId={Number(user.id)} />}

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
      </main>
    </>
  );
}
