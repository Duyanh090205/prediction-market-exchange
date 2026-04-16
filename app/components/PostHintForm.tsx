"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PostHintForm({ contractId }: { contractId: number }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/hints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId,
          content,
          linkUrl: linkUrl || undefined,
          linkLabel: linkLabel || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to post hint");
      } else {
        // Reset form on success
        setContent("");
        setLinkUrl("");
        setLinkLabel("");
        setIsExpanded(false);
        router.refresh(); // Refresh page to see new hint
      }
    } catch (err) {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        style={{
          width: "100%",
          padding: "0.75rem",
          background: "transparent",
          color: "#818cf8",
          border: "1px dashed #2a2a3e",
          borderRadius: "0.5rem",
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: "pointer",
          marginBottom: "1rem"
        }}
      >
        + Add New Hint
      </button>
    );
  }

  return (
    <div style={{ padding: "1rem", background: "#12121a", border: "1px solid #2a2a3e", borderRadius: "0.5rem", marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#e4e4ed", margin: "0 0 1rem" }}>Post a Hint</h3>
      
      {error && (
        <div style={{ padding: "0.5rem", background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: "0.75rem", borderRadius: "0.25rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Market context, news quote, or reasoning..."
          required
          rows={3}
          style={{ width: "100%", padding: "0.5rem", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.25rem", color: "#e4e4ed", fontSize: "0.875rem", resize: "vertical" }}
        />
        
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Optional Source URL (https://...)"
          style={{ width: "100%", padding: "0.5rem", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.25rem", color: "#e4e4ed", fontSize: "0.875rem" }}
        />

        {linkUrl && (
          <input
            type="text"
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Optional Link Label (e.g. 'Read Bloomberg Article')"
            style={{ width: "100%", padding: "0.5rem", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.25rem", color: "#e4e4ed", fontSize: "0.875rem" }}
          />
        )}

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            style={{ padding: "0.5rem 1rem", background: "transparent", color: "#8888a0", border: "none", fontSize: "0.875rem", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            style={{ padding: "0.5rem 1rem", background: "#6366f1", color: "#fff", border: "none", borderRadius: "0.25rem", fontSize: "0.875rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "Posting..." : "Post Hint"}
          </button>
        </div>
      </form>
    </div>
  );
}
