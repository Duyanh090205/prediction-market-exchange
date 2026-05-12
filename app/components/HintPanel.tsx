"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface HintAuthor {
  id: number;
  username: string;
  role: string;
}

interface Hint {
  id: number;
  content: string;
  linkUrl: string | null;
  linkLabel: string | null;
  createdAt: string | Date;
  author: HintAuthor;
}

interface HintPanelProps {
  hints: Hint[];
  contractId: number;
  currentUserId: number;
  currentUserRole: string;
}

function HintItem({
  hint,
  currentUserId,
  currentUserRole,
  onDelete,
}: {
  hint: Hint;
  currentUserId: number;
  currentUserRole: string;
  onDelete: (id: number) => void;
}) {
  const isAuthor = hint.author.id === currentUserId;
  const canDelete = isAuthor || currentUserRole === "ADMIN";
  const [loading, setLoading] = useState(false);

  const linkText = hint.linkLabel || hint.linkUrl;

  const handleDelete = async () => {
    if (!confirm("Delete this hint?")) return;
    setLoading(true);
    try {
      const res = await fetch(withTradingBasePath(`/api/hints/${hint.id}`), {
        method: "DELETE",
      });
      if (res.ok) {
        onDelete(hint.id);
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? `Delete failed (${res.status})`);
      }
    } catch {
      alert("Network error — could not delete hint.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        padding: "0.75rem",
        background: "#0a0a0f",
        borderRadius: "0.375rem",
        border: "1px solid #1a1a2e",
      }}
    >
      <p
        style={{
          margin: "0 0 0.375rem",
          fontSize: "0.875rem",
          color: "#e4e4ed",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {hint.content}
      </p>

      {hint.linkUrl && linkText && (
        <a
          href={hint.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginBottom: "0.375rem",
            fontSize: "0.8125rem",
            color: "#818cf8",
            textDecoration: "none",
          }}
          onMouseOver={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.textDecoration =
              "underline")
          }
          onMouseOut={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.textDecoration =
              "none")
          }
        >
          🔗 {linkText}
        </a>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "0.75rem", color: "#5a5a72" }}>
          {hint.author.username} ·{" "}
          {new Date(hint.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              color: "#5a5a72",
              fontSize: "0.75rem",
              cursor: loading ? "not-allowed" : "pointer",
              padding: "0",
            }}
            onMouseOver={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "#ef4444")
            }
            onMouseOut={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "#5a5a72")
            }
          >
            {loading ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}

function PostHintForm({
  contractId,
  onPosted,
}: {
  contractId: number;
  onPosted: (hint: Hint) => void;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(withTradingBasePath("/api/hints"), {
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
        setError(data.error ?? "Failed to post hint.");
        return;
      }
      setContent("");
      setLinkUrl("");
      setLinkLabel("");
      setOpen(false);
      onPosted(data.hint);
      router.refresh();
    } catch {
      setError("Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          padding: "0.5rem",
          background: "transparent",
          border: "1px dashed #3a3a5e",
          borderRadius: "0.375rem",
          color: "#6366f1",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: "pointer",
          marginTop: "0.5rem",
        }}
      >
        + Add Hint
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        marginTop: "0.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {error && (
        <p style={{ fontSize: "0.75rem", color: "#ef4444", margin: 0 }}>
          {error}
        </p>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
        placeholder="Hint content..."
        rows={3}
        style={{
          padding: "0.5rem 0.75rem",
          background: "#0a0a0f",
          border: "1px solid #2a2a3e",
          borderRadius: "0.375rem",
          color: "#e4e4ed",
          fontSize: "0.875rem",
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <input
        type="url"
        value={linkUrl}
        onChange={(e) => setLinkUrl(e.target.value)}
        placeholder="Link URL (optional)"
        style={{
          padding: "0.5rem 0.75rem",
          background: "#0a0a0f",
          border: "1px solid #2a2a3e",
          borderRadius: "0.375rem",
          color: "#e4e4ed",
          fontSize: "0.875rem",
          outline: "none",
        }}
      />
      <input
        type="text"
        value={linkLabel}
        onChange={(e) => setLinkLabel(e.target.value)}
        placeholder="Link label (optional)"
        style={{
          padding: "0.5rem 0.75rem",
          background: "#0a0a0f",
          border: "1px solid #2a2a3e",
          borderRadius: "0.375rem",
          color: "#e4e4ed",
          fontSize: "0.875rem",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            flex: 1,
            padding: "0.5rem",
            background: "#6366f1",
            border: "none",
            borderRadius: "0.375rem",
            color: "#fff",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Posting..." : "Post Hint"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError("");
          }}
          style={{
            padding: "0.5rem 0.75rem",
            background: "transparent",
            border: "1px solid #2a2a3e",
            borderRadius: "0.375rem",
            color: "#8888a0",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function HintPanel({
  hints,
  contractId,
  currentUserId,
  currentUserRole,
}: HintPanelProps) {
  const [localHints, setLocalHints] = useState<Hint[]>(hints);
  const canPostHint =
    currentUserRole === "LIQUIDITY_PROVIDER" || currentUserRole === "ADMIN";

  const handleDelete = (id: number) => {
    setLocalHints((prev) => prev.filter((h) => h.id !== id));
  };

  const handlePosted = (hint: Hint) => {
    setLocalHints((prev) => [...prev, hint]);
  };

  return (
    <div>
      <p
        style={{
          fontSize: "0.75rem",
          color: "#5a5a72",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
          margin: "0 0 0.75rem",
        }}
      >
        Hints ({localHints.length})
      </p>

      {localHints.length === 0 && (
        <p style={{ fontSize: "0.875rem", color: "#5a5a72", margin: "0 0 0.5rem" }}>
          No hints posted yet.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {localHints.map((h) => (
          <HintItem
            key={h.id}
            hint={h}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {canPostHint && (
        <PostHintForm contractId={contractId} onPosted={handlePosted} />
      )}
    </div>
  );
}
