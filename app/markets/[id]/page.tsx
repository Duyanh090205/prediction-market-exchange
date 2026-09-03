import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import ContractRoom from "@/app/components/ContractRoom";
import MarketPosition from "@/app/components/MarketPosition";
import GuestBanner from "@/app/components/GuestBanner";
import PriceChart from "@/app/components/PriceChart";
import QuoteCard from "@/app/components/QuoteCard";
import HintPanel from "@/app/components/HintPanel";
import PostQuoteForm from "@/app/components/PostQuoteForm";
import MarketOrderForm from "@/app/components/MarketOrderForm";
import AdminDeleteMarketButton from "@/app/components/AdminDeleteMarketButton";
import SettleMarketButton from "@/app/components/SettleMarketButton";
import ChatPanel from "@/app/components/ChatPanel";
import OrderBook, { type BookLevel, type BookEntry } from "@/app/components/OrderBook";
import { contractDay } from "@/lib/formatDate";
import TradeTape, { type TapeRow } from "@/app/components/TradeTape";

// Always render this page fresh. It is a live order book — ContractRoom calls
// router.refresh() whenever a quote or a fill arrives on the socket — so there
// is never a correct answer to serve from a cached render. The home page and
// /demo already carry the same declaration; this page relied on cookies() to
// make it dynamic by accident.
export const dynamic = "force-dynamic";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Readable without an account. Everything that writes is gated on `user`.
  const user = await getLabUser();

  const { id } = await params;
  const contractId = Number(id);
  if (isNaN(contractId)) notFound();

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    // lockedResult is globally omitted; opt back in server-side. It is only
    // rendered (and passed to the client) for the market's creator below.
    omit: { lockedResult: false },
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
        // No status filter: settlement flips every trade to SETTLED, and
        // filtering on OPEN emptied the tape of the one market that has the
        // most to show — the settled one, where each leg carries realized P&L.
        include: {
          taker: { select: { id: true, username: true } },
          maker: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      messages: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!contract) notFound();

  const currentUserId = user ? Number(user.id) : -1;
  const currentUserRole = user?.role ?? "GUEST";
  const isAdmin = currentUserRole === "ADMIN";
  const isSettled = contract.status === "SETTLED";
  const canPostHint =
    currentUserRole === "LIQUIDITY_PROVIDER" || currentUserRole === "ADMIN";
  // Everyone — including admins — can quote and trade.
  const canPostQuote = true;

  const creatorId = contract.createdById;
  const isCreator = creatorId != null && currentUserId === creatorId;
  const canSettle = (isAdmin || isCreator) && contract.status === "OPEN";

  // Unified order book: every OPEN quote — the creator's primary market, player
  // quotes, and resting limit orders — aggregated by price level. The engine
  // matches across all of them best-price-first, so one book is the truth.
  const askLevels = new Map<number, BookLevel>();
  const bidLevels = new Map<number, BookLevel>();
  const addEntry = (map: Map<number, BookLevel>, price: number, e: BookEntry) => {
    const lvl = map.get(price) ?? { price, size: 0, entries: [] };
    lvl.size += e.size;
    lvl.entries.push(e);
    map.set(price, lvl);
  };
  for (const q of contract.quotes) {
    const base = {
      quoteId: q.id,
      makerId: q.maker.id,
      username: q.maker.username,
      isCreator: creatorId != null && q.maker.id === creatorId,
      isYou: q.maker.id === currentUserId,
    };
    if (q.ask != null && (q.askSize ?? 0) > 0) addEntry(askLevels, q.ask, { ...base, size: q.askSize! });
    if (q.bid != null && (q.bidSize ?? 0) > 0) addEntry(bidLevels, q.bid, { ...base, size: q.bidSize! });
  }
  // Time priority within a level: the engine sweeps createdAt-ascending, and
  // Quote ids are autoincrement (≈ creation order), so ordering each level's
  // entries by quoteId makes the expanded list match who actually fills first.
  for (const lvl of [...askLevels.values(), ...bidLevels.values()]) {
    lvl.entries.sort((a, b) => a.quoteId - b.quoteId);
  }
  const asks = [...askLevels.values()].sort((a, b) => a.price - b.price); // best (lowest) first
  const bids = [...bidLevels.values()].sort((a, b) => b.price - a.price); // best (highest) first

  // The viewer's own open quotes/resting orders — managed (edit/cancel) below the forms.
  const myQuotes = contract.quotes.filter((q) => q.maker.id === currentUserId);

  // Chat history (newest-50 fetched desc → render oldest-first).
  const chatMessages = [...contract.messages].reverse().map((m) => ({
    id: m.id,
    contractId: m.contractId,
    recipientId: m.recipientId,
    userId: m.userId,
    username: m.user.username,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));

  // One row per print. The taker is the aggressor; the maker holds the other
  // side, so OVER and UNDER are derived from takerSide rather than stored.
  const tapeRows: TapeRow[] = contract.trades.map((t) => {
    const overIsTaker = t.takerSide === "OVER";
    const overUser = overIsTaker ? t.taker : t.maker;
    const underUser = overIsTaker ? t.maker : t.taker;
    return {
      id: t.id,
      takerSide: t.takerSide as "OVER" | "UNDER",
      strike: t.strike,
      size: t.size,
      at: t.createdAt.toISOString(),
      over: {
        id: overUser.id,
        username: overUser.username,
        pnl: overIsTaker ? t.takerPnl : t.makerPnl,
      },
      under: {
        id: underUser.id,
        username: underUser.username,
        pnl: overIsTaker ? t.makerPnl : t.takerPnl,
      },
    };
  });

  const settlesLabel = contract.settlesAt ? contractDay(contract.settlesAt) : null;
  const settledLabel = contract.settledAt ? contractDay(contract.settledAt) : null;

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
      <ContractRoom contractId={contractId} authed={!!user} />
      {!user && <GuestBanner />}
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
            {canSettle && (
              <SettleMarketButton
                contractId={contract.id}
                minPrice={contract.minPrice}
                maxPrice={contract.maxPrice}
                // Locked-mode settle for the creator only. Conditional spread,
                // not a ternary to undefined: even the prop KEY must not appear
                // in the serialized RSC payload for non-creators (admin included).
                {...(isCreator && contract.lockedResult != null
                  ? { lockedResult: contract.lockedResult }
                  : {})}
              />
            )}
            {isAdmin && contract.status === "OPEN" && (
              <AdminDeleteMarketButton contractId={contract.id} />
            )}
          </div>
          <p style={{ margin: 0, fontSize: "0.9375rem", color: "#8888a0", lineHeight: 1.5 }}>
            {contract.description}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "#5a5a72" }}>
            Price band: <strong style={{ color: "#818cf8" }}>{contract.minPrice}</strong> – <strong style={{ color: "#818cf8" }}>{contract.maxPrice}</strong>
            {contract.status === "OPEN" && contract.settlesAt != null && (
              <> · Settles <strong style={{ color: "#818cf8" }}>{settlesLabel}</strong></>
            )}
            {contract.status === "SETTLED" && contract.settlementValue != null && (
              <>
                {" "}· Settled at <strong style={{ color: "#f59e0b" }}>{contract.settlementValue}</strong>
                {contract.settledAt != null && <> on <strong style={{ color: "#818cf8" }}>{settledLabel}</strong></>}
              </>
            )}
          </p>
          {isCreator && contract.lockedResult != null && contract.status === "OPEN" && (
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "#f59e0b" }}>
              🔒 Your locked result: <strong>{contract.lockedResult}</strong>
              <span style={{ color: "#5a5a72" }}> — only you can see this; the market settles at exactly this value.</span>
            </p>
          )}
        </div>

        {/* Live transaction-price chart */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ padding: "1rem 1.25rem", background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem" }}>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.6875rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Transaction Price
            </p>
            <PriceChart
              contractId={contractId}
              minPrice={contract.minPrice}
              maxPrice={contract.maxPrice}
              variant="transaction"
              authed={!!user}
            />
          </div>
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
          {/* ── LEFT COLUMN: unified order book + hints ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <OrderBook asks={asks} bids={bids} isAdmin={isAdmin} minPrice={contract.minPrice} maxPrice={contract.maxPrice} />

            {/* Hints — the card is gated with its contents, not around them:
                rendering the shell with nothing in it left an empty box. Only
                market makers and admins can post one, so for everyone else an
                empty hint list has nothing to offer and nothing to add to. */}
            {user && (contract.hints.length > 0 || canPostHint) && (
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
            )}
          </div>

          {/* ── RIGHT COLUMN: order forms + your open quotes ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {isSettled && (
              <div
                style={{
                  padding: "1.25rem",
                  background: "rgba(245,158,11,0.06)",
                  border: "1px solid rgba(245,158,11,0.25)",
                  borderRadius: "0.75rem",
                }}
              >
                <p style={{ ...sectionLabel, color: "#f59e0b" }}>Settled</p>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "#8888a0", lineHeight: 1.6 }}>
                  This market closed at{" "}
                  <strong style={{ color: "#f59e0b" }}>{contract.settlementValue}</strong>. Every
                  open position was marked against that value in one transaction:
                  each trade below carries the P&amp;L it realized, and the same
                  amounts moved through the players&apos; balances and the ledger.
                </p>
              </div>
            )}

            {!user && contract.status === "OPEN" && (
              <div
                style={{
                  padding: "1.25rem",
                  background: "#12121a",
                  border: "1px solid #1a1a2e",
                  borderRadius: "0.75rem",
                }}
              >
                <p style={sectionLabel}>Order Entry</p>
                <p
                  style={{
                    margin: "0 0 1.25rem",
                    fontSize: "0.875rem",
                    color: "#8888a0",
                    lineHeight: 1.6,
                  }}
                >
                  Market orders, resting limit orders and your position ledger
                  sit behind the session. The book on the left is the one they
                  execute against — nothing is simulated for signed-out
                  visitors.
                </p>
                <a
                  href="/login"
                  style={{
                    display: "inline-block",
                    padding: "0.5rem 1.25rem",
                    background: "#6366f1",
                    color: "#fff",
                    borderRadius: "0.375rem",
                    textDecoration: "none",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                  }}
                >
                  Sign in to place orders
                </a>
              </div>
            )}

            {user && <MarketPosition userId={currentUserId} contractId={contractId} />}

            {user && canPostQuote && contract.status === "OPEN" && (
              <MarketOrderForm
                contractId={contractId}
                minPrice={contract.minPrice}
                maxPrice={contract.maxPrice}
                mode="market"
              />
            )}

            {user && canPostQuote && contract.status === "OPEN" && (
              <MarketOrderForm
                contractId={contractId}
                minPrice={contract.minPrice}
                maxPrice={contract.maxPrice}
                mode="limit"
              />
            )}

            {user && canPostQuote && contract.status === "OPEN" && (
              <PostQuoteForm
                contractId={contractId}
                currentUserRole={currentUserRole}
                minPrice={contract.minPrice}
                maxPrice={contract.maxPrice}
              />
            )}

            {user && myQuotes.length > 0 && (
              <>
                <p style={{ ...sectionLabel, margin: "0.5rem 0 0" }}>
                  Your Open Quotes &amp; Resting Orders
                </p>
                {myQuotes.map((q) => (
                  <QuoteCard
                    key={q.id}
                    quote={q}
                    currentUserId={currentUserId}
                    currentUserRole={currentUserRole}
                    variant="regular"
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Market Chat ── */}
        <div style={{ marginBottom: "2rem" }}>
          {user && (
            <ChatPanel contractId={contractId} currentUserId={currentUserId} initialMessages={chatMessages} />
          )}
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
            {isSettled && (
              <span style={{ color: "#f59e0b", marginLeft: "0.5rem" }}>
                · settled at {contract.settlementValue} · P&amp;L is realized and paid
              </span>
            )}
          </p>

          <TradeTape rows={tapeRows} isSettled={isSettled} isAdmin={isAdmin} />
        </div>
      </main>
    </>
  );
}
