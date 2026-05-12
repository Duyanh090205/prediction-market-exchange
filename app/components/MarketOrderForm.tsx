"use client";

import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface MarketOrderFormProps {
  contractId: number;
  minPrice: number;
  maxPrice: number;
}

export default function MarketOrderForm({
  contractId,
  minPrice,
  maxPrice,
}: MarketOrderFormProps) {
  const [side, setSide] = useState<"OVER" | "UNDER">("OVER");
  const [size, setSize] = useState<string>("");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sizeNum = parseInt(size, 10);
    const limitNum = parseInt(limitPrice, 10);

    if (!sizeNum || sizeNum < 1) {
      setError("Size must be at least 1");
      return;
    }
    if (isNaN(limitNum) || limitNum < minPrice || limitNum > maxPrice) {
      setError(`Limit price must be between ${minPrice} and ${maxPrice}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setWarning(null);
    setSuccess(null);

    try {
      const res = await fetch(withTradingBasePath("/api/orders"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": uuidv7(),
        },
        body: JSON.stringify({
          contractId,
          type: "MARKET",
          side,
          size: sizeNum,
          limitPrice: limitNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Trade failed");
      } else {
        if (data.warning) {
          setWarning(data.warning);
        } else {
          setSuccess(`Successfully filled ${data.totalFilled} contracts!`);
          setSize("");
          setLimitPrice("");
        }
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        padding: "1.25rem",
        background: "#12121a",
        border: "1px solid #2a2a3e",
        borderRadius: "0.75rem",
      }}
    >
      <h3
        style={{
          margin: "0 0 1rem",
          fontSize: "0.875rem",
          fontWeight: 700,
          color: "#e4e4ed",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Sweep Market
      </h3>

      <form onSubmit={submit}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button
            type="button"
            onClick={() => setSide("OVER")}
            style={{
              flex: 1,
              padding: "0.5rem",
              background: side === "OVER" ? "rgba(239,68,68,0.2)" : "transparent",
              border: `1px solid ${side === "OVER" ? "#ef4444" : "#2a2a3e"}`,
              borderRadius: "0.375rem",
              color: side === "OVER" ? "#ef4444" : "#8888a0",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            BUY OVER
          </button>
          <button
            type="button"
            onClick={() => setSide("UNDER")}
            style={{
              flex: 1,
              padding: "0.5rem",
              background: side === "UNDER" ? "rgba(34,197,94,0.2)" : "transparent",
              border: `1px solid ${side === "UNDER" ? "#22c55e" : "#2a2a3e"}`,
              borderRadius: "0.375rem",
              color: side === "UNDER" ? "#22c55e" : "#8888a0",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            BUY UNDER
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#8888a0", marginBottom: "0.25rem" }}>
              Total Size
            </label>
            <input
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 10"
              min={1}
              required
              disabled={submitting}
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                background: "#0a0a0f",
                border: "1px solid #2a2a3e",
                borderRadius: "0.375rem",
                color: "#e4e4ed",
                fontSize: "0.875rem",
                boxSizing: "border-box"
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#8888a0", marginBottom: "0.25rem" }}>
              Limit Price ({minPrice}–{maxPrice})
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={`e.g. ${Math.floor((minPrice + maxPrice) / 2)}`}
              min={minPrice}
              max={maxPrice}
              required
              disabled={submitting}
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                background: "#0a0a0f",
                border: "1px solid #2a2a3e",
                borderRadius: "0.375rem",
                color: "#e4e4ed",
                fontSize: "0.875rem",
                boxSizing: "border-box"
              }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "0.75rem",
            background: "#6366f1",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Sweeping Book..." : "Execute Market Order"}
        </button>

        {error && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#ef4444" }}>
            {error}
          </p>
        )}
        {warning && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#f59e0b" }}>
            {warning}
          </p>
        )}
        {success && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#22c55e" }}>
            {success}
          </p>
        )}
      </form>
    </div>
  );
}
