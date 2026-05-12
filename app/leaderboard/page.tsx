import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";

export default async function LeaderboardPage() {
  const currentUser = await getLabUser();
  if (!currentUser) redirect("/");

  // Rank by SUM(delta) from SETTLEMENT entries — authoritative P&L source
  const ledgerTotals = await prisma.balanceLedger.groupBy({
    by: ["userId"],
    where: { eventType: "SETTLEMENT" },
    _sum: { delta: true },
    orderBy: { _sum: { delta: "desc" } },
  });

  const userIds = ledgerTotals.map((r) => r.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, role: { not: "ADMIN" } },
    select: { id: true, username: true, role: true, balance: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Also include non-admin users with no settlements (show them at the bottom with 0)
  const allUsers = await prisma.user.findMany({
    where: { role: { not: "ADMIN" } },
    select: { id: true, username: true, role: true, balance: true },
    orderBy: { username: "asc" },
  });
  const rankedIds = new Set(userIds);
  const unranked = allUsers.filter((u) => !rankedIds.has(u.id));

  const rows = [
    ...ledgerTotals.map((r) => ({
      user: userMap.get(r.userId)!,
      pnl: r._sum.delta ?? 0,
    })),
    ...unranked.map((u) => ({ user: u, pnl: 0 })),
  ].filter((r) => r.user);

  return (
    <>
      <Navbar />
      <main style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
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
          Leaderboard
        </h1>
        <p style={{ color: "#5a5a72", fontSize: "0.875rem", marginBottom: "2rem" }}>
          Ranked by total settlement P&amp;L
        </p>

        <div
          style={{
            background: "#12121a",
            border: "1px solid #1a1a2e",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["#", "Player", "Role", "Balance", "Settlement P&L"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "0.75rem 1rem",
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
              {rows.map(({ user, pnl }, idx) => (
                <tr
                  key={user.id}
                  style={{
                    background:
                      user.id === Number(currentUser.id)
                        ? "rgba(99,102,241,0.06)"
                        : "transparent",
                  }}
                >
                  <td
                    style={{
                      padding: "0.75rem 1rem",
                      color: idx === 0 ? "#f59e0b" : "#5a5a72",
                      fontWeight: idx < 3 ? 700 : 400,
                      fontSize: "0.875rem",
                      borderBottom: "1px solid #1a1a2e",
                    }}
                  >
                    {idx + 1}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 1rem",
                      color: "#e4e4ed",
                      fontWeight: 500,
                      fontSize: "0.9375rem",
                      borderBottom: "1px solid #1a1a2e",
                    }}
                  >
                    {user.username}
                    {user.id === Number(currentUser.id) && (
                      <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#818cf8" }}>
                        (you)
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 1rem",
                      color: "#5a5a72",
                      fontSize: "0.8125rem",
                      borderBottom: "1px solid #1a1a2e",
                    }}
                  >
                    {user.role === "LIQUIDITY_PROVIDER"
                      ? "Market Maker"
                      : user.role === "ADMIN"
                      ? "Admin"
                      : "Player"}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 1rem",
                      color: "#8888a0",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "0.875rem",
                      borderBottom: "1px solid #1a1a2e",
                    }}
                  >
                    {user.balance.toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 1rem",
                      color: pnl > 0 ? "#22c55e" : pnl < 0 ? "#ef4444" : "#5a5a72",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "0.9375rem",
                      borderBottom: "1px solid #1a1a2e",
                    }}
                  >
                    {pnl > 0 ? "+" : ""}
                    {pnl.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
