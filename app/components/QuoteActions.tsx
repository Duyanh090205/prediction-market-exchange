"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface QuoteActionsProps {
  quoteId: number;
  currentBid: number | null;
  currentAsk: number | null;
  currentSize: number;
  makerRole?: string;
}

export default function QuoteActions({
  quoteId,
  currentBid,
  currentAsk,
  currentSize,
  makerRole,
}: QuoteActionsProps) {
  const router = useRouter();
  const isLP = makerRole === "LIQUIDITY_PROVIDER";
  const [editing, setEditing] = useState(false);
  const [bid, setBid] = useState(currentBid == null ? "" : String(currentBid));
  const [ask, setAsk] = useState(currentAsk == null ? "" : String(currentAsk));
  const [size, setSize] = useState(String(currentSize));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEdit = async (e: React.FormEvent) => {
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
      setError("Market makers must keep both bid and ask.");
      return;
    }
    if (bidNum === null && askNum === null) {
      setError("Quote must keep at least a bid or an ask.");
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

    setLoading(true);
    try {
      const res = await fetch(withTradingBasePath(`/api/quotes/${quoteId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bid: bidNum, ask: askNum, size: sizeNum }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update quote.");
        return;
      }

      setEditing(false);
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Cancel this quote?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(withTradingBasePath(`/api/quotes/${quoteId}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? "Failed to cancel quote.");
        return;
      }

      router.refresh();
    } catch {
      alert("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (editing) {
    const inputStyle: React.CSSProperties = {
      padding: "0.375rem 0.5rem",
      background: "#0a0a0f",
      border: "1px solid #2a2a3e",
      borderRadius: "0.25rem",
      color: "#e4e4ed",
      fontSize: "0.8125rem",
      outline: "none",
      width: "5rem",
    };

    return (
      <form
        onSubmit={handleEdit}
        style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}
      >
        {error && (
          <p style={{ fontSize: "0.75rem", color: "#ef4444", margin: 0 }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.75rem", color: "#22c55e", fontWeight: 600 }}>
            Bid
            <input
              type="number"
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              required={isLP}
              placeholder={isLP ? "" : "blank = none"}
              style={{ ...inputStyle, marginLeft: "0.25rem", borderColor: "rgba(34,197,94,0.3)" }}
            />
          </label>
          <label style={{ fontSize: "0.75rem", color: "#ef4444", fontWeight: 600 }}>
            Ask
            <input
              type="number"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              required={isLP}
              placeholder={isLP ? "" : "blank = none"}
              style={{ ...inputStyle, marginLeft: "0.25rem", borderColor: "rgba(239,68,68,0.3)" }}
            />
          </label>
          <label style={{ fontSize: "0.75rem", color: "#8888a0", fontWeight: 600 }}>
            Size
            <input
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              required
              min={1}
              style={{ ...inputStyle, marginLeft: "0.25rem" }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "0.375rem 0.75rem",
              background: "#6366f1",
              border: "none",
              borderRadius: "0.25rem",
              color: "#fff",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError("");
              setBid(currentBid == null ? "" : String(currentBid));
              setAsk(currentAsk == null ? "" : String(currentAsk));
              setSize(String(currentSize));
            }}
            style={{
              padding: "0.375rem 0.75rem",
              background: "transparent",
              border: "1px solid #2a2a3e",
              borderRadius: "0.25rem",
              color: "#8888a0",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
      <button
        onClick={() => setEditing(true)}
        disabled={loading}
        style={{
          padding: "0.3rem 0.625rem",
          background: "transparent",
          border: "1px solid #2a2a3e",
          borderRadius: "0.25rem",
          color: "#8888a0",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
        title="Edit quote"
      >
        Edit
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        style={{
          padding: "0.3rem 0.625rem",
          background: "transparent",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: "0.25rem",
          color: "#ef4444",
          fontSize: "0.75rem",
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.5 : 1,
        }}
      >
        Cancel Quote
      </button>
    </div>
  );
}
