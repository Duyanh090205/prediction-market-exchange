"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface ApiKey {
  id: number;
  label: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const card: React.CSSProperties = {
  background: "#12121a",
  border: "1px solid #1a1a2e",
  borderRadius: "0.75rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1rem",
  background: "#0a0a0f",
  border: "1px solid #2a2a3e",
  borderRadius: "0.5rem",
  color: "#e4e4ed",
  fontSize: "0.9375rem",
  boxSizing: "border-box",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [allowTrade, setAllowTrade] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(withTradingBasePath("/api/keys"));
      const data = await res.json();
      if (res.ok) setKeys(data.keys);
      else setError(data.error || "Failed to load keys");
    } catch {
      setError("Network error loading keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNewSecret(null);
    setCopied(false);

    const scopes = allowTrade ? ["read", "trade"] : ["read"];

    try {
      const res = await fetch(withTradingBasePath("/api/keys"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, scopes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create key");
      } else {
        setNewSecret(data.secret);
        setLabel("");
        await load();
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    if (!confirm("Revoke this key? Any bot using it will stop working immediately.")) return;
    setError(null);
    try {
      const res = await fetch(withTradingBasePath(`/api/keys/${id}`), { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to revoke key");
      } else {
        await load();
      }
    } catch {
      setError("Network error revoking key");
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
        API Keys
      </h1>
      <p style={{ color: "#5a5a72", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Create a key to let a bot trade on your behalf via the{" "}
        <code style={{ color: "#818cf8" }}>/api/v1</code> endpoints. Authenticate with{" "}
        <code style={{ color: "#818cf8" }}>Authorization: Bearer tgk_…</code>
      </p>

      {/* ── One-time secret banner ── */}
      {newSecret && (
        <div style={{ ...card, padding: "1.25rem 1.5rem", marginBottom: "1.5rem", border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.06)" }}>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", fontWeight: 700, color: "#10b981" }}>
            Your new API key — copy it now, it won&apos;t be shown again
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ flex: 1, minWidth: "260px", padding: "0.6rem 0.85rem", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.5rem", color: "#e4e4ed", fontSize: "0.85rem", wordBreak: "break-all" }}>
              {newSecret}
            </code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(newSecret);
                setCopied(true);
              }}
              style={{ padding: "0.6rem 1rem", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: "0.5rem", color: "#10b981", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewSecret(null)}
            style={{ marginTop: "0.75rem", background: "none", border: "none", color: "#5a5a72", fontSize: "0.75rem", cursor: "pointer", padding: 0 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Create form ── */}
      <div style={{ ...card, padding: "1.5rem", marginBottom: "2rem" }}>
        <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.8125rem", color: "#8888a0", display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
              Label
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., my-market-maker-bot"
              required
              disabled={creating}
              maxLength={80}
              style={inputStyle}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#e4e4ed", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={allowTrade}
              onChange={(e) => setAllowTrade(e.target.checked)}
              disabled={creating}
            />
            Allow trading (place orders &amp; quotes). Uncheck for a read-only key.
          </label>
          {error && <p style={{ color: "#ef4444", fontSize: "0.875rem", margin: 0 }}>{error}</p>}
          <button
            type="submit"
            disabled={creating}
            style={{ alignSelf: "flex-start", padding: "0.75rem 1.5rem", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: "0.5rem", color: "#818cf8", fontWeight: 600, cursor: creating ? "not-allowed" : "pointer", fontSize: "0.9375rem", opacity: creating ? 0.7 : 1 }}
          >
            {creating ? "Creating…" : "Create API Key"}
          </button>
        </form>
      </div>

      {/* ── Key list ── */}
      <h2 style={{ fontSize: "0.75rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 1rem" }}>
        Your keys ({keys.length})
      </h2>

      {loading ? (
        <p style={{ color: "#5a5a72", fontSize: "0.875rem" }}>Loading…</p>
      ) : keys.length === 0 ? (
        <div style={{ ...card, padding: "2.5rem", textAlign: "center", border: "1px dashed #2a2a3e", color: "#5a5a72" }}>
          No API keys yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {keys.map((k) => {
            const revoked = k.revokedAt != null;
            return (
              <div
                key={k.id}
                style={{ ...card, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", opacity: revoked ? 0.55 : 1 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#e4e4ed" }}>{k.label}</span>
                    <code style={{ fontSize: "0.75rem", color: "#8888a0" }}>{k.keyPrefix}…</code>
                    {k.scopes.map((s) => (
                      <span key={s} style={{ padding: "0.1rem 0.5rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 600, color: s === "trade" ? "#f59e0b" : "#8888a0", background: s === "trade" ? "rgba(245,158,11,0.12)" : "rgba(136,136,160,0.12)" }}>
                        {s}
                      </span>
                    ))}
                    {revoked && (
                      <span style={{ padding: "0.1rem 0.5rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 600, color: "#ef4444", background: "rgba(239,68,68,0.12)" }}>
                        revoked
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
                    Created {fmt(k.createdAt)} · Last used {fmt(k.lastUsedAt)}
                  </p>
                </div>
                {!revoked && (
                  <button
                    onClick={() => revoke(k.id)}
                    style={{ padding: "0.5rem 0.9rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: "0.5rem", color: "#ef4444", fontWeight: 600, cursor: "pointer", fontSize: "0.8125rem" }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
