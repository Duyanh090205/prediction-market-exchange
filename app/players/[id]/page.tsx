import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import PlayerChat from "@/app/components/PlayerChat";
import { sideColor } from "@/lib/theme";

// Public player portfolio — any logged-in user can view another player's
// balance and the positions they're currently holding (#7). Read-only.
export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getLabUser();
  if (!viewer) redirect("/");

  const { id } = await params;
  const playerId = Number(id);
  if (isNaN(playerId)) notFound();

  const player = await prisma.user.findUnique({
    where: { id: playerId },
    select: { id: true, username: true, role: true, balance: true },
  });
  if (!player) notFound();

  const openTrades = await prisma.trade.findMany({
    where: {
      status: "OPEN",
      OR: [{ takerId: playerId }, { makerId: playerId }],
    },
    include: {
      contract: { select: { id: true, title: true } },
      taker: { select: { id: true, username: true } },
      maker: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const settledTrades = await prisma.trade.findMany({
    where: {
      status: "SETTLED",
      OR: [{ takerId: playerId }, { makerId: playerId }],
    },
    include: {
      contract: { select: { id: true, title: true, settlementValue: true } },
      taker: { select: { id: true, username: true } },
      maker: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const settledPnl = settledTrades.reduce(
    (sum, t) => sum + ((t.takerId === playerId ? t.takerPnl : t.makerPnl) ?? 0),
    0
  );

  const roleLabel =
    player.role === "LIQUIDITY_PROVIDER"
      ? "Market Maker"
      : player.role === "ADMIN"
        ? "Admin"
        : "Player";

  const viewerId = Number(viewer.id);
  const isSelf = player.id === viewerId;

  // Direct-message history between the viewer and this player (both directions).
  const dmRows = isSelf
    ? []
    : await prisma.message.findMany({
        where: {
          OR: [
            { userId: viewerId, recipientId: playerId },
            { userId: playerId, recipientId: viewerId },
          ],
        },
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
  const dmMessages = [...dmRows].reverse().map((m) => ({
    id: m.id,
    contractId: m.contractId,
    recipientId: m.recipientId,
    userId: m.userId,
    username: m.user.username,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <>
      <Navbar />
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <Link href="/leaderboard" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
          ← Leaderboard
        </Link>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4ed", margin: 0 }}>
            {player.username}
            {isSelf && <span style={{ marginLeft: "0.5rem", fontSize: "0.8125rem", color: "#818cf8" }}>(you)</span>}
          </h1>
          <span style={{ fontSize: "0.8125rem", color: "#5a5a72" }}>{roleLabel}</span>
        </div>
        <p style={{ margin: "0 0 1.5rem", fontSize: "0.9375rem", color: "#8888a0" }}>
          Balance: <strong style={{ color: "#e4e4ed" }}>{player.balance.toLocaleString()}</strong> coins
        </p>

        {!isSelf && (
          <div style={{ marginBottom: "2rem" }}>
            <PlayerChat
              peerId={player.id}
              peerUsername={player.username}
              currentUserId={viewerId}
              initialMessages={dmMessages}
            />
          </div>
        )}

        <h2 style={{ fontSize: "0.75rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 1rem" }}>
          Open Positions ({openTrades.length})
        </h2>

        {openTrades.length === 0 ? (
          <div style={{ padding: "2.5rem", textAlign: "center", background: "#12121a", border: "1px dashed #2a2a3e", borderRadius: "0.75rem", color: "#5a5a72" }}>
            No open positions.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {openTrades.map((t) => {
              const isAsTaker = t.takerId === playerId;
              const side = isAsTaker ? t.takerSide : t.takerSide === "OVER" ? "UNDER" : "OVER";
              const oppSide = side === "OVER" ? "UNDER" : "OVER";
              const counterparty = isAsTaker ? t.maker : t.taker;
              const c = sideColor(side as "OVER" | "UNDER");
              return (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.875rem 1.25rem",
                    background: "#12121a",
                    border: "1px solid #1a1a2e",
                    borderRadius: "0.625rem",
                  }}
                >
                  <div>
                    <Link href={`/markets/${t.contract.id}`} style={{ fontSize: "0.875rem", fontWeight: 600, color: "#818cf8", textDecoration: "none" }}>
                      {t.contract.title}
                    </Link>
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
                      <span style={{ color: c.fg, fontWeight: 700 }}>{side} {t.strike}</span>
                      {" · "}size {t.size}
                      {" · vs "}
                      <Link href={`/players/${counterparty.id}`} style={{ color: "#8888a0", textDecoration: "none" }}>
                        {counterparty.username}
                      </Link>
                      {" "}({oppSide})
                    </p>
                  </div>
                  <span
                    style={{
                      padding: "0.2rem 0.6rem",
                      background: c.bg,
                      border: `1px solid ${c.border}`,
                      borderRadius: "9999px",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: c.fg,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {side} {t.strike}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Settled history (public, with P&L) ── */}
        <h2 style={{ fontSize: "0.75rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", margin: "2.5rem 0 0.5rem" }}>
          History ({settledTrades.length})
        </h2>
        {settledTrades.length > 0 && (
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "#8888a0" }}>
            Settled P&amp;L:{" "}
            <strong style={{ color: settledPnl > 0 ? "#22c55e" : settledPnl < 0 ? "#ef4444" : "#8888a0", fontVariantNumeric: "tabular-nums" }}>
              {settledPnl > 0 ? "+" : ""}{settledPnl.toLocaleString()}
            </strong>
          </p>
        )}

        {settledTrades.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", background: "#12121a", border: "1px dashed #2a2a3e", borderRadius: "0.75rem", color: "#5a5a72", fontSize: "0.875rem" }}>
            No settled trades yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {settledTrades.map((t) => {
              const isAsTaker = t.takerId === playerId;
              const side = isAsTaker ? t.takerSide : t.takerSide === "OVER" ? "UNDER" : "OVER";
              const oppSide = side === "OVER" ? "UNDER" : "OVER";
              const counterparty = isAsTaker ? t.maker : t.taker;
              const pnl = (isAsTaker ? t.takerPnl : t.makerPnl) ?? 0;
              const pnlColor = pnl > 0 ? "#10b981" : pnl < 0 ? "#ef4444" : "#8888a0";
              const c = sideColor(side as "OVER" | "UNDER");
              return (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.875rem 1.25rem",
                    background: "#12121a",
                    border: "1px solid #1a1a2e",
                    borderRadius: "0.625rem",
                  }}
                >
                  <div>
                    <Link href={`/markets/${t.contract.id}`} style={{ fontSize: "0.875rem", fontWeight: 600, color: "#818cf8", textDecoration: "none" }}>
                      {t.contract.title}
                    </Link>
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
                      <span style={{ color: c.fg, fontWeight: 700 }}>{side} {t.strike}</span>
                      {" · "}size {t.size}
                      {" · vs "}
                      <Link href={`/players/${counterparty.id}`} style={{ color: "#8888a0", textDecoration: "none" }}>
                        {counterparty.username}
                      </Link>
                      {" "}({oppSide})
                      {t.contract.settlementValue != null && <> · result {t.contract.settlementValue}</>}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontSize: "0.6875rem", color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.05em" }}>P&amp;L</p>
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
