"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminQuoteDelete({
  quoteId,
  makerName,
}: {
  quoteId: number;
  makerName: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        `Cancel ${makerName}'s quote? Any pending take requests will be rejected and ${makerName} will be notified.`
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? `Failed to cancel quote (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      alert("Network error — could not cancel quote.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "0.75rem" }}>
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
        title="Admin: cancel this quote"
      >
        {loading ? "Cancelling…" : "Cancel Quote (Admin)"}
      </button>
    </div>
  );
}
