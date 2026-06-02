import { getLabUser } from "@/lib/labAuth";
import Link from "next/link";
import SignOutButton from "./SignOutButton";
import NotificationPanel from "./NotificationPanel";
import PortfolioLive from "./PortfolioLive";
import { prisma } from "@/lib/prisma";
import { calculateAvailableMargin } from "@/lib/margin";

const ROLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  LIQUIDITY_PROVIDER: {
    label: "Market Maker",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
  },
  ADMIN: {
    label: "Admin",
    color: "#f97316",
    bg: "rgba(249,115,22,0.12)",
  },
};

export default async function Navbar() {
  const user = await getLabUser();
  if (!user) return null;

  const { username, role } = user;
  const badge = ROLE_BADGE[role];
  const userId = Number(user.id);

  const [dbUser, availableMargin] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { balance: true } }),
    calculateAvailableMargin(userId),
  ]);

  if (!dbUser) return null;

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        minHeight: "3.5rem",
        background: "rgba(18,18,26,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #2a2a3e",
      }}
    >
      {/* Left: logo + nav links */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <Link
          href="/"
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            background: "linear-gradient(135deg, #6366f1, #818cf8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            textDecoration: "none",
            letterSpacing: "-0.01em",
          }}
        >
          Trading Game
        </Link>
        <Link href="/leaderboard" style={{ fontSize: "0.875rem", color: "#8888a0", textDecoration: "none" }}>
          Leaderboard
        </Link>
        <Link href="/positions" style={{ fontSize: "0.875rem", color: "#8888a0", textDecoration: "none" }}>
          Positions
        </Link>
        {role === "ADMIN" && (
          <Link href="/admin" style={{ fontSize: "0.875rem", color: "#f97316", textDecoration: "none" }}>
            Admin
          </Link>
        )}
      </div>

      {/* Right: user info */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <NotificationPanel />

        {badge && (
          <span
            style={{
              padding: "0.2rem 0.6rem",
              borderRadius: "0.25rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: badge.color,
              background: badge.bg,
            }}
          >
            {badge.label}
          </span>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginRight: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.875rem",
              color: "#e4e4ed",
              fontWeight: 600,
            }}
          >
            {username}
          </span>
          <div style={{ fontSize: "0.7rem", color: "#8888a0", display: "flex", gap: "0.4rem" }}>
            <span>Bal: <strong style={{ color: "#e4e4ed", fontWeight: 500 }}>{dbUser.balance.toLocaleString()}</strong></span>
            <span>|</span>
            <span>Margin: <strong style={{ color: availableMargin >= 0 ? "#10b981" : "#ef4444", fontWeight: 500 }}>{availableMargin.toLocaleString()}</strong></span>
          </div>
        </div>

        <SignOutButton />
        <PortfolioLive />
      </div>
    </nav>
  );
}
