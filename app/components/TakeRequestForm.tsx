"use client";

// Stub for CP-3 — fully implemented in CP-5 (Margin Calculator + Trading APIs)

interface TakeRequestFormProps {
  quoteId: number;
  quoteSize: number;
  bid: number;
  ask: number;
}

export default function TakeRequestForm({
  quoteId: _quoteId,
  quoteSize,
  bid,
  ask,
}: TakeRequestFormProps) {
  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "1rem",
        background: "rgba(99,102,241,0.06)",
        border: "1px dashed #3a3a5e",
        borderRadius: "0.5rem",
      }}
    >
      <p
        style={{
          fontSize: "0.75rem",
          color: "#5a5a72",
          marginBottom: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        Take Position
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <button
          disabled
          title={`OVER ${ask}`}
          style={{
            flex: 1,
            padding: "0.5rem",
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.2)",
            borderRadius: "0.375rem",
            color: "#22c55e",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "not-allowed",
            opacity: 0.6,
          }}
        >
          OVER {ask}
        </button>
        <button
          disabled
          title={`UNDER ${bid}`}
          style={{
            flex: 1,
            padding: "0.5rem",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "0.375rem",
            color: "#ef4444",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "not-allowed",
            opacity: 0.6,
          }}
        >
          UNDER {bid}
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="number"
          disabled
          placeholder={`Size (max ${quoteSize})`}
          min={1}
          max={quoteSize}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            background: "#0a0a0f",
            border: "1px solid #2a2a3e",
            borderRadius: "0.375rem",
            color: "#5a5a72",
            fontSize: "0.875rem",
            cursor: "not-allowed",
          }}
        />
        <button
          disabled
          style={{
            padding: "0.5rem 1rem",
            background: "#2a2a3e",
            border: "none",
            borderRadius: "0.375rem",
            color: "#5a5a72",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "not-allowed",
          }}
        >
          Submit
        </button>
      </div>

      <p
        style={{
          marginTop: "0.5rem",
          fontSize: "0.75rem",
          color: "#5a5a72",
          fontStyle: "italic",
        }}
      >
        Trading will be enabled once the trading flow is live.
      </p>
    </div>
  );
}
