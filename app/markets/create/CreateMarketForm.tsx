"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";


export default function CreateMarketPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minPrice, setMinPrice] = useState("0");
  const [maxPrice, setMaxPrice] = useState("100");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    const minP = parseInt(minPrice, 10);
    const maxP = parseInt(maxPrice, 10);
    if (!Number.isInteger(minP) || !Number.isInteger(maxP) || minP >= maxP) {
      setError("Price band: min must be a strictly smaller integer than max.");
      setCreating(false);
      return;
    }

    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, description, minPrice: minP, maxPrice: maxP }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create market");
        setCreating(false);
      } else {
        router.push(`/markets/${data.contract.id}`);
        router.refresh();
      }
    } catch {
      setError("Network error — please try again");
      setCreating(false);
    }
  }

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

  const labelStyle: React.CSSProperties = {
    fontSize: "0.8125rem",
    color: "#8888a0",
    display: "block",
    marginBottom: "0.5rem",
    fontWeight: 600,
  };

  return (
    <main style={{ maxWidth: "700px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <Link
          href="/"
          style={{ fontSize: "0.875rem", color: "#5a5a72", textDecoration: "none", display: "inline-block", marginBottom: "1.5rem" }}
        >
          ← Back to Markets
        </Link>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e4e4ed", marginBottom: "2rem" }}>
          Create New Market
        </h1>

        <div style={{ padding: "2rem", background: "#12121a", border: "1px solid #1a1a2e", borderRadius: "1rem" }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div>
              <label style={labelStyle}>Market Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Will it rain tomorrow?"
                required
                disabled={creating}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Description / Rules</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide clear resolution rules and conditions..."
                required
                rows={5}
                disabled={creating}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={labelStyle}>Min Price</label>
                <input
                  type="number"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  required
                  disabled={creating}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Max Price</label>
                <input
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  required
                  disabled={creating}
                  style={inputStyle}
                />
              </div>
            </div>
            <p style={{ margin: "-0.5rem 0 0", fontSize: "0.75rem", color: "#5a5a72" }}>
              Settlement value and all bid/ask prices must fall inside this band.
            </p>

            {error && <p style={{ color: "#ef4444", fontSize: "0.875rem", margin: 0 }}>{error}</p>}

            <button
              type="submit"
              disabled={creating}
              style={{
                padding: "0.875rem 1.5rem",
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.4)",
                borderRadius: "0.5rem",
                color: "#818cf8",
                fontWeight: 600,
                cursor: creating ? "not-allowed" : "pointer",
                fontSize: "1rem",
                transition: "all 0.2s ease",
                opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? "Opening Market..." : "Open Market"}
            </button>
          </form>
        </div>
      </main>
  );
}
