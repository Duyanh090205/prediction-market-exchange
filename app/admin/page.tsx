import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminDashboard() {
  const user = await getLabUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  const [userCount, pendingUserCount, contractCount, openTradeCount, recentAudits] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.contract.count(),
    prisma.trade.count({ where: { status: "OPEN" } }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, action: true, note: true, createdAt: true },
    }),
  ]);

  const cards = [
    { label: "Total Users", value: userCount, href: "/admin/users" },
    {
      label: "Pending Approvals",
      value: pendingUserCount,
      href: pendingUserCount > 0 ? "/admin/users" : null,
      highlight: pendingUserCount > 0,
    },
    { label: "Total Contracts", value: contractCount, href: "/admin/contracts" },
    { label: "Open Trades", value: openTradeCount, href: null },
  ];

  return (
    <>
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <Link href="/" style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}>
          ← Markets
        </Link>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "#e4e4ed",
            marginBottom: "2rem",
          }}
        >
          Admin Dashboard
        </h1>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          {cards.map((card) => (
            <div
              key={card.label}
              style={{
                padding: "1.5rem",
                background: card.highlight ? "rgba(245,158,11,0.08)" : "#12121a",
                border: card.highlight ? "1px solid rgba(245,158,11,0.4)" : "1px solid #1a1a2e",
                borderRadius: "0.75rem",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: card.highlight ? "#f59e0b" : "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {card.label}
              </p>
              <p style={{ margin: 0, fontSize: "2rem", fontWeight: 700, color: card.highlight ? "#f59e0b" : "#e4e4ed" }}>
                {card.value}
              </p>
              {card.href && (
                <Link href={card.href} style={{ fontSize: "0.8125rem", color: "#818cf8", textDecoration: "none" }}>
                  Manage →
                </Link>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
          {[
            { href: "/admin/users", label: "Manage Users" },
            { href: "/admin/contracts", label: "Manage Contracts" },
            { href: "/admin/audit-log", label: "Audit Log" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                padding: "0.75rem 1.5rem",
                background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: "0.5rem",
                color: "#818cf8",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.9375rem",
              }}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Recent admin actions */}
        <div style={{ background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "0.75rem", padding: "1.25rem 1.5rem" }}>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            Recent Admin Actions
          </p>
          {recentAudits.length === 0 ? (
            <p style={{ margin: 0, color: "#5a5a72", fontSize: "0.8125rem" }}>No admin actions logged yet.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {recentAudits.map((a) => (
                <li key={a.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid #1a1a2e", fontSize: "0.8125rem", display: "flex", gap: "0.75rem" }}>
                  <span style={{ color: "#5a5a72", whiteSpace: "nowrap" }}>{new Date(a.createdAt).toLocaleString()}</span>
                  <span style={{ color: "#818cf8", fontWeight: 600 }}>{a.action}</span>
                  <span style={{ color: "#8888a0" }}>{a.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
