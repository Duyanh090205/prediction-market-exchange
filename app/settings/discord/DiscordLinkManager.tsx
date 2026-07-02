"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

const card: React.CSSProperties = {
  background: "#12121a",
  border: "1px solid #1a1a2e",
  borderRadius: "0.75rem",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function DiscordLinkManager({
  linked,
  discordUsername,
  discordLinkedAt,
  banner,
}: {
  linked: boolean;
  discordUsername: string | null;
  discordLinkedAt: string | null;
  banner: { kind: "ok" | "err"; msg: string } | null;
}) {
  const router = useRouter();
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlink() {
    if (!confirm("Unlink Discord? You'll stop receiving personal DMs and can't use the Discord commands.")) return;
    setUnlinking(true);
    setError(null);
    try {
      const res = await fetch(withTradingBasePath("/api/discord/unlink"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Unlink failed");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <main style={{ maxWidth: "820px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link
        href="/"
        style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1rem" }}
      >
        ← Markets
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4ed", marginBottom: "0.25rem" }}>
        Discord Link
      </h1>
      <p style={{ color: "#5a5a72", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Link your Discord account to get personal notifications and place orders right from Discord.
      </p>

      {banner && (
        <div
          style={{
            ...card,
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            border: banner.kind === "ok" ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(239,68,68,0.4)",
            background: banner.kind === "ok" ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
            color: banner.kind === "ok" ? "#10b981" : "#ef4444",
            fontSize: "0.875rem",
          }}
        >
          {banner.msg}
        </div>
      )}

      <div style={{ ...card, padding: "1.5rem" }}>
        {linked ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ padding: "0.1rem 0.55rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 600, color: "#10b981", background: "rgba(16,185,129,0.12)" }}>
                  linked
                </span>
                <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#e4e4ed" }}>
                  {discordUsername || "Discord"}
                </span>
              </div>
              <p style={{ margin: "0.4rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
                Linked {fmt(discordLinkedAt)}
              </p>
            </div>
            <button
              onClick={unlink}
              disabled={unlinking}
              style={{ padding: "0.5rem 0.9rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: "0.5rem", color: "#ef4444", fontWeight: 600, cursor: unlinking ? "not-allowed" : "pointer", fontSize: "0.8125rem", opacity: unlinking ? 0.7 : 1 }}
            >
              {unlinking ? "Unlinking…" : "Unlink"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={{ margin: 0, color: "#8888a0", fontSize: "0.875rem" }}>
              No Discord account linked yet.
            </p>
            <a
              href={withTradingBasePath("/api/discord/oauth/start")}
              style={{ alignSelf: "flex-start", padding: "0.75rem 1.5rem", background: "rgba(88,101,242,0.15)", border: "1px solid rgba(88,101,242,0.5)", borderRadius: "0.5rem", color: "#a5b4fc", fontWeight: 600, textDecoration: "none", fontSize: "0.9375rem" }}
            >
              Link Discord
            </a>
          </div>
        )}
        {error && <p style={{ color: "#ef4444", fontSize: "0.875rem", margin: "1rem 0 0" }}>{error}</p>}
      </div>
    </main>
  );
}
