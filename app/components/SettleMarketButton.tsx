"use client";

// Settle a market from its own page. Visible to the market's creator and to
// admins (server gates the same in /api/contracts/[id]/settle). Settlement is
// irreversible, so it asks for explicit confirmation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface SettleMarketButtonProps {
  contractId: number;
  minPrice: number;
  maxPrice: number;
}

export default function SettleMarketButton({
  contractId,
  minPrice,
  maxPrice,
}: SettleMarketButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function settle() {
    const val = parseInt(value, 10);
    if (isNaN(val) || val < minPrice || val > maxPrice) {
      setMsg(`Value must be between ${minPrice} and ${maxPrice}`);
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch(withTradingBasePath(`/api/contracts/${contractId}/settle`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuidv7() },
        body: JSON.stringify({ settlementValue: val }),
      });
      const data = await res.json();
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setMsg(data.error ?? "Failed to settle");
      }
    } catch {
      setMsg("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setValue("");
          setMsg(null);
        }}
        style={{
          padding: "0.2rem 0.6rem",
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: "0.25rem",
          color: "#ef4444",
          fontSize: "0.6875rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          cursor: "pointer",
        }}
      >
        Settle
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      <input
        type="number"
        placeholder={`Result (${minPrice}–${maxPrice})`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        min={minPrice}
        max={maxPrice}
        disabled={submitting}
        style={{
          padding: "0.3rem 0.5rem",
          background: "#0a0a0f",
          border: "1px solid #2a2a3e",
          borderRadius: "0.25rem",
          color: "#e4e4ed",
          fontSize: "0.8125rem",
          width: "150px",
        }}
      />
      <button
        onClick={settle}
        disabled={submitting}
        title="Settlement is irreversible"
        style={{
          padding: "0.3rem 0.7rem",
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: "0.25rem",
          color: "#ef4444",
          fontWeight: 600,
          fontSize: "0.75rem",
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Settling…" : "Confirm Settle"}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setMsg(null);
        }}
        disabled={submitting}
        style={{
          padding: "0.3rem 0.6rem",
          background: "transparent",
          border: "1px solid #2a2a3e",
          borderRadius: "0.25rem",
          color: "#5a5a72",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
      {msg && <span style={{ fontSize: "0.75rem", color: "#f59e0b" }}>{msg}</span>}
    </span>
  );
}
