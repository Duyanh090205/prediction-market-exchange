"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface LimitOrderFormProps {
  quoteId: number;
  contractId: number;
  quoteSize: number;
  bid: number | null;
  ask: number | null;
}

export default function LimitOrderForm({
  quoteId,
  contractId,
  quoteSize,
  bid,
  ask,
}: LimitOrderFormProps) {
  const router = useRouter();
  const [size, setSize] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(side: "OVER" | "UNDER") {
    const sizeNum = parseInt(size, 10);
    if (!sizeNum || sizeNum < 1 || sizeNum > quoteSize) {
      setError(`Size must be between 1 and ${quoteSize}`);
      return;
    }
    setSubmitting(true);
    setError(null);
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
          type: "LIMIT",
          side,
          size: sizeNum,
          quoteId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Trade failed");
      } else {
        setSuccess(`Successfully filled ${data.totalFilled} ${side} contracts!`);
        setSize("");
        router.refresh();
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
        marginTop: "1rem",
        padding: "1rem",
        background: "rgba(34,197,94,0.04)",
        border: "1px solid rgba(34,197,94,0.15)",
        borderRadius: "0.5rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            color: "#22c55e",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          Instant Trade (Limit)
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder={`Enter size first (max ${quoteSize})`}
          min={1}
          max={quoteSize}
          disabled={submitting}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            background: "#0a0a0f",
            border: "1px solid #2a2a3e",
            borderRadius: "0.375rem",
            color: "#e4e4ed",
            fontSize: "0.875rem",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => submit("UNDER")}
          disabled={submitting || bid == null}
          title={bid == null ? "Maker has not posted a bid — cannot buy UNDER" : ""}
          style={{
            flex: 1,
            padding: "0.5rem",
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: "0.375rem",
            color: "#22c55e",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: submitting || bid == null ? "not-allowed" : "pointer",
            opacity: submitting || bid == null ? 0.4 : 1,
          }}
        >
          {bid != null ? `Buy UNDER @ ${bid}` : "UNDER unavailable"}
        </button>
        <button
          onClick={() => submit("OVER")}
          disabled={submitting || ask == null}
          title={ask == null ? "Maker has not posted an ask — cannot buy OVER" : ""}
          style={{
            flex: 1,
            padding: "0.5rem",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "0.375rem",
            color: "#ef4444",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: submitting || ask == null ? "not-allowed" : "pointer",
            opacity: submitting || ask == null ? 0.4 : 1,
          }}
        >
          {ask != null ? `Buy OVER @ ${ask}` : "OVER unavailable"}
        </button>
      </div>

      {error && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#ef4444" }}>
          {error}
        </p>
      )}
      {success && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#22c55e" }}>
          {success}
        </p>
      )}
      {submitting && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#5a5a72" }}>
          Executing...
        </p>
      )}
    </div>
  );
}
