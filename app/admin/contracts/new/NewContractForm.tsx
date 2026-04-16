"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewContractForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, description }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create contract");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {error && (
        <div style={{ padding: "0.75rem", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "0.5rem", color: "#ef4444" }}>
          {error}
        </div>
      )}

      <div>
        <label style={{ display: "block", fontSize: "0.875rem", color: "#8888a0", marginBottom: "0.5rem" }}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={{ width: "100%", padding: "0.75rem", background: "#12121a", border: "1px solid #2a2a3e", borderRadius: "0.5rem", color: "#e4e4ed", fontSize: "1rem" }}
          placeholder="e.g. BTC to cross $100k by Dec 31?"
        />
      </div>

      <div>
        <label style={{ display: "block", fontSize: "0.875rem", color: "#8888a0", marginBottom: "0.5rem" }}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={5}
          style={{ width: "100%", padding: "0.75rem", background: "#12121a", border: "1px solid #2a2a3e", borderRadius: "0.5rem", color: "#e4e4ed", fontSize: "1rem", resize: "vertical" }}
          placeholder="Detailed rules for settlement and context..."
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{ padding: "0.75rem", background: loading ? "#4f46e5" : "#6366f1", color: "#fff", border: "none", borderRadius: "0.5rem", fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
      >
        {loading ? "Creating..." : "Create Contract"}
      </button>
    </form>
  );
}
