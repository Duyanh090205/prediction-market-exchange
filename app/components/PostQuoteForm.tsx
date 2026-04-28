"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PostQuoteFormProps {
  contractId: number;
  currentUserRole: string;
  minPrice: number;
  maxPrice: number;
}

export default function PostQuoteForm({
  contractId,
  currentUserRole,
  minPrice,
  maxPrice,
}: PostQuoteFormProps) {
  const router = useRouter();
  const isLP = currentUserRole === "LIQUIDITY_PROVIDER";

  const [bid, setBid] = useState("");
  const [ask, setAsk] = useState("");
  const [size, setSize] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const bidStr = bid.trim();
    const askStr = ask.trim();
    const bidNum = bidStr === "" ? null : parseInt(bidStr, 10);
    const askNum = askStr === "" ? null : parseInt(askStr, 10);
    const sizeNum = parseInt(size, 10);

    if (bidStr !== "" && (bidNum === null || isNaN(bidNum))) {
      setError("Bid must be an integer.");
      return;
    }
    if (askStr !== "" && (askNum === null || isNaN(askNum))) {
      setError("Ask must be an integer.");
      return;
    }
    if (isNaN(sizeNum)) {
      setError("Size must be an integer.");
      return;
    }
    if (isLP && (bidNum === null || askNum === null)) {
      setError("Market makers must post both bid and ask.");
      return;
    }
    if (bidNum === null && askNum === null) {
      setError("Provide at least a bid or an ask.");
      return;
    }
    if (bidNum !== null && askNum !== null && bidNum >= askNum) {
      setError("Bid must be strictly less than ask.");
      return;
    }
    if (sizeNum < 1) {
      setError("Size must be at least 1.");
      return;
    }
    if (bidNum !== null && (bidNum < minPrice || bidNum > maxPrice)) {
      setError(`Bid must be between ${minPrice} and ${maxPrice}.`);
      return;
    }
    if (askNum !== null && (askNum < minPrice || askNum > maxPrice)) {
      setError(`Ask must be between ${minPrice} and ${maxPrice}.`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId,
          bid: bidNum,
          ask: askNum,
          size: sizeNum,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to post quote.");
        return;
      }

      setBid("");
      setAsk("");
      setSize("");
      setCollapsed(true);
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          width: "100%",
          padding: "0.625rem",
          background: "transparent",
          border: "1px dashed #3a3a5e",
          borderRadius: "0.5rem",
          color: "#6366f1",
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#6366f1";
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(99,102,241,0.06)";
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#3a3a5e";
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        + Post a Quote
      </button>
    );
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "0.5rem 0.75rem",
    background: "#0a0a0f",
    border: "1px solid #2a2a3e",
    borderRadius: "0.375rem",
    color: "#e4e4ed",
    fontSize: "0.875rem",
    outline: "none",
    minWidth: 0,
  };

  return (
    <div
      style={{
        padding: "1rem",
        background: "#12121a",
        border: "1px solid #2a2a3e",
        borderRadius: "0.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <p
          style={{
            fontSize: "0.75rem",
            color: "#8888a0",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
            margin: 0,
          }}
        >
          Post a Quote
        </p>
        <button
          onClick={() => {
            setCollapsed(true);
            setError("");
          }}
          style={{
            background: "none",
            border: "none",
            color: "#5a5a72",
            cursor: "pointer",
            fontSize: "1rem",
            lineHeight: 1,
            padding: "0.125rem",
          }}
        >
          ✕
        </button>
      </div>

      {!isLP && (
        <p style={{ fontSize: "0.75rem", color: "#5a5a72", margin: "0 0 0.625rem 0" }}>
          Leave bid or ask blank to post only one side.
        </p>
      )}

      {error && (
        <p
          style={{
            fontSize: "0.8125rem",
            color: "#ef4444",
            marginBottom: "0.625rem",
            margin: "0 0 0.625rem 0",
          }}
        >
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                fontSize: "0.6875rem",
                color: "#22c55e",
                display: "block",
                marginBottom: "0.25rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Bid {isLP ? "" : "(optional)"}
            </label>
            <input
              type="number"
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              required={isLP}
              placeholder="200"
              style={{ ...inputStyle, borderColor: "rgba(34,197,94,0.3)" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                fontSize: "0.6875rem",
                color: "#ef4444",
                display: "block",
                marginBottom: "0.25rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Ask {isLP ? "" : "(optional)"}
            </label>
            <input
              type="number"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              required={isLP}
              placeholder="240"
              style={{ ...inputStyle, borderColor: "rgba(239,68,68,0.3)" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                fontSize: "0.6875rem",
                color: "#8888a0",
                display: "block",
                marginBottom: "0.25rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Size
            </label>
            <input
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              required
              min={1}
              placeholder="25"
              style={inputStyle}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.5rem",
            background: loading ? "#4f46e5" : "#6366f1",
            border: "none",
            borderRadius: "0.375rem",
            color: "#fff",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            transition: "background 0.15s",
          }}
        >
          {loading ? "Posting..." : "Post Quote"}
        </button>
      </form>
    </div>
  );
}
