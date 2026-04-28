"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminDeleteMarketButton({ contractId }: { contractId: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this market? All open trades and quotes will be wiped and margin returned.")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete market");
        setLoading(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("An unexpected error occurred.");
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      style={{
        padding: "0.3rem 0.75rem",
        background: "transparent",
        border: "1px solid rgba(239, 68, 68, 0.3)",
        borderRadius: "0.25rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "#ffffff",
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.7 : 1,
        transition: "all 0.2s",
        marginLeft: "auto", // pushes to the right if flex container allows
      }}
    >
      {loading ? "Deleting..." : "Delete Market"}
    </button>
  );
}
