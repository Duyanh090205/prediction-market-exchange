import { auth } from "@/auth";
import Link from "next/link";
import SignOutButton from "./SignOutButton";

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
  const session = await auth();
  if (!session?.user) return null;

  const { username, role } = session.user;
  const badge = ROLE_BADGE[role];

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 1.5rem",
        height: "3.5rem",
        background: "rgba(18,18,26,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #2a2a3e",
      }}
    >
      {/* Left: logo */}
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

      {/* Right: user info */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {/* Notification bell stub */}
        <div
          title="Notifications (coming soon)"
          style={{
            width: "2rem",
            height: "2rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.375rem",
            color: "#5a5a72",
            cursor: "default",
            fontSize: "1rem",
          }}
        >
          🔔
        </div>

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

        <span
          style={{
            fontSize: "0.875rem",
            color: "#e4e4ed",
            fontWeight: 500,
          }}
        >
          {username}
        </span>

        <SignOutButton />
      </div>
    </nav>
  );
}
