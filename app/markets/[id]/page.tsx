import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import ContractRoom from "@/app/components/ContractRoom";
import PriceChart from "@/app/components/PriceChart";
import QuoteCard from "@/app/components/QuoteCard";
import HintPanel from "@/app/components/HintPanel";
import PostQuoteForm from "@/app/components/PostQuoteForm";
import MarketOrderForm from "@/app/components/MarketOrderForm";
import AdminTradeDelete from "@/app/components/AdminTradeDelete";
import AdminDeleteMarketButton from "@/app/components/AdminDeleteMarketButton";
import { sideColor } from "@/lib/theme";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getLabUser();
  if (!user) redirect("/");

  const { id } = await params;
  const contractId = Number(id);
  if (isNaN(contractId)) notFound();

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      quotes: {
        where: { status: "OPEN" },
        include: {
          maker: { select: { id: true, username: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      hints: {
        include: {
          author: { select: { id: true, username: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      trades: {
        where: { status: "OPEN" },
        include: {
          taker: { select: { id: true, username: true } },
          maker: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!contract) notFound();

  const currentUserId = Number(user.id);
  const currentUserRole = user.role;
  const isAdmin = currentUserRole === "ADMIN";
  const canPostQuote = !isAdmin;

  // Separate LP quotes (left column) from other quotes (right column)
  const lpQuotes = contract.quotes.filter(
    (q) => q.maker.role === "LIQUIDITY_PROVIDER"
  );
  const otherQuotes = contract.quotes.filter(
    (q) => q.maker.role !== "LIQUIDITY_PROVIDER"
  );

  const sectionLabel: React.CSSProperties = {
    fontSize: "0.6875rem",
    fontWeight: 700,
    color: "#5a5a72",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    margin: "0 0 0.75rem",
  };

  return (
    <>
      <Navbar />
      <ContractRoom contractId={contractId} />
      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: "1rem" }}>
          <Link
            href="/"
            style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none" }}
          >
            ← Markets
          </Link>
        </div>

        {/* Contract header */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "#e4e4ed",
                margin: 0,
              }}
            >
              {contract.title}
            </h1>
            <span
              style={{
                padding: "0.2rem 0.6rem",
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.25)",
                borderRadius: "0.25rem",
                fontSize: "0.6875rem",
                fontWeight: 700,
                color: "#22c55e",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {contract.status}
            </span>
            {isAdmin && contract.status === "OPEN" && (
              <AdminDeleteMarketButton contractId={contract.id} />
            )}
          </div>
          <p style={{ margin: 0, fontSize: "0.9375rem", color: "#8888a0", lineHeight: 1.5 }}>
            {contract.description}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "#5a5a72" }}>
            Price band: <strong style={{ color: "#818cf8" }}>{contract.minPrice}</strong> – <strong style={{ color: "#818cf8" }}>{contract.maxPrice}</strong>
            {contract.status === "SETTLED" && contract.settlementValue != null && (
              <> · Settled at <strong style={{ color: "#818cf8" }}>{contract.settlementValue}</strong></>
            )}
          </p>
        </div>

        {/* Live price chart */}
        <div style={{ marginBottom: "2rem", padding: "1rem 1.25rem", background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem" }}>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.6875rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Market Price
          </p>
          <PriceChart contractId={contractId} minPrice={contract.minPrice} maxPrice={contract.maxPrice} />
        </div>

        {/* Two-column layout */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1.5rem",
            marginBottom: "2rem",
          }}
        >
          {/* ── LEFT COLUMN: LP quotes + hints ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={sectionLabel}>Primary Market</p>

            {lpQuotes.length === 0 ? (
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
                No primary market quotes yet.
              </div>
            ) : (
              lpQuotes.map((q) => (
                <QuoteCard
                  key={q.id}
                  quote={q}
                  contractId={contractId}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                  variant="prominent"
                />
              ))
            )}

            {/* Hints */}
            <div
              style={{
                marginTop: "0.5rem",
                padding: "1.25rem",
                background: "#12121a",
                border: "1px solid #1a1a2e",
                borderRadius: "0.75rem",
              }}
            >
              <HintPanel
                hints={contract.hints}
                contractId={contractId}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />
            </div>
          </div>

          {/* ── RIGHT COLUMN: other quotes + post form ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={sectionLabel}>Player Quotes</p>

            {otherQuotes.length === 0 && (
              <div
                style={{
                  padding: "1.25rem",
                  textAlign: "center",
                  background: "#12121a",
                  border: "1px dashed #2a2a3e",
                  borderRadius: "0.5rem",
                  color: "#5a5a72",
                  fontSize: "0.875rem",
                }}
              >
                No player quotes yet.
              </div>
            )}

            {otherQuotes.map((q) => (
              <QuoteCard
                key={q.id}
                quote={q}
                contractId={contractId}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                variant="regular"
              />
            ))}

            {canPostQuote && contract.status === "OPEN" && (
              <MarketOrderForm
                contractId={contractId}
                minPrice={contract.minPrice}
                maxPrice={contract.maxPrice}
              />
            )}

            {canPostQuote && contract.status === "OPEN" && (
              <PostQuoteForm
                contractId={contractId}
                currentUserRole={currentUserRole}
                minPrice={contract.minPrice}
                maxPrice={contract.maxPrice}
              />
            )}
          </div>
        </div>

        {/* ── Confirmed Trades ── */}
        <div
          style={{
            padding: "1.5rem",
            background: "#12121a",
            border: "1px solid #1a1a2e",
            borderRadius: "0.75rem",
          }}
        >
          <p
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#5a5a72",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 1rem",
            }}
          >
            Confirmed Trades ({contract.trades.length})
          </p>

          {contract.trades.length === 0 ? (
            <p style={{ color: "#5a5a72", fontSize: "0.875rem", margin: 0 }}>
              No confirmed trades yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.875rem",
                }}
              >
                <thead>
                  <tr>
                    {["Taker", "Side", "Strike", "Size", "Maker", "Time", ...(isAdmin ? [""] : [])].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.6875rem",
                          fontWeight: 700,
                          color: "#5a5a72",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contract.trades.map((t) => (
                    <tr key={t.id}>
                      <td
                        style={{
                          padding: "0.625rem 0.75rem",
                          color: "#e4e4ed",
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {t.taker.username}
                      </td>
                      <td
                        style={{
                          padding: "0.625rem 0.75rem",
                          fontWeight: 700,
                          color: sideColor(t.takerSide as "OVER" | "UNDER").fg,
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {t.takerSide}
                      </td>
                      <td
                        style={{
                          padding: "0.625rem 0.75rem",
                          color: "#818cf8",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {t.strike}
                      </td>
                      <td
                        style={{
                          padding: "0.625rem 0.75rem",
                          color: "#e4e4ed",
                          fontVariantNumeric: "tabular-nums",
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {t.size}
                      </td>
                      <td
                        style={{
                          padding: "0.625rem 0.75rem",
                          color: "#8888a0",
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {t.maker.username}
                      </td>
                      <td
                        style={{
                          padding: "0.625rem 0.75rem",
                          color: "#5a5a72",
                          fontSize: "0.75rem",
                          whiteSpace: "nowrap",
                          borderBottom: "1px solid #1a1a2e",
                        }}
                      >
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      {isAdmin && (
                        <td style={{ padding: "0.625rem 0.75rem", borderBottom: "1px solid #1a1a2e" }}>
                          <AdminTradeDelete tradeId={t.id} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
