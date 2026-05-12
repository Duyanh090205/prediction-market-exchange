"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

export default function AdminTradeDelete({ tradeId }: { tradeId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        "Delete this confirmed trade? Both parties will be notified and their margin will free up."
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(withTradingBasePath(`/api/trades/${tradeId}`), { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? `Failed to delete trade (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      alert("Network error — could not delete trade.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      style={{
        padding: "0.2rem 0.5rem",
        background: "transparent",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: "0.25rem",
        color: "#ef4444",
        fontSize: "0.75rem",
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.5 : 1,
      }}
      title="Admin: delete this trade"
    >
      {loading ? "…" : "Delete"}
    </button>
  );
}
