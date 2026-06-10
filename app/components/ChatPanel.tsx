"use client";

// Realtime chat panel (#8). Used per-market (contractId set — joins the existing
// `contract:<id>` Socket.IO room via ContractRoom) and in the global lobby
// (contractId null — receives broadcast messages). Initial history is rendered
// server-side; new messages arrive over the socket and on the sender's own POST.

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket-client";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

export interface ChatMessage {
  id: number;
  contractId: number | null;
  recipientId: number | null;
  userId: number;
  username: string;
  body: string;
  createdAt: string;
}

interface ChatPanelProps {
  contractId: number | null;
  currentUserId: number;
  initialMessages: ChatMessage[];
  /** When set, this is a 1-1 direct-message thread with that user. */
  peerId?: number;
}

export default function ChatPanel({ contractId, currentUserId, initialMessages, peerId }: ChatPanelProps) {
  const isDM = peerId != null;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Append a message unless we already have it (socket + POST can both deliver).
  function addMessage(m: ChatMessage) {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (m: ChatMessage) => {
      const belongs = isDM
        ? // DM thread between me and the peer (either direction)
          m.recipientId != null &&
          ((m.userId === currentUserId && m.recipientId === peerId) ||
            (m.userId === peerId && m.recipientId === currentUserId))
        : // lobby/market room — exclude DMs (which also have contractId null)
          m.recipientId == null && (m.contractId ?? null) === (contractId ?? null);
      if (belongs) addMessage(m);
    };
    socket.on("MESSAGE_CREATED", onMessage);
    return () => {
      socket.off("MESSAGE_CREATED", onMessage);
    };
  }, [contractId, peerId, currentUserId, isDM]);

  // Keep the view pinned to the latest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(withTradingBasePath("/api/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isDM ? { recipientId: peerId, body } : { contractId, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send");
        return;
      }
      addMessage(data.message); // instant echo even if the socket is down
      setText("");
    } catch {
      setError("Network error — try again");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#12121a",
        border: "1px solid #1a1a2e",
        borderRadius: "0.75rem",
        overflow: "hidden",
      }}
    >
      <p style={{ margin: 0, padding: "0.75rem 1rem", fontSize: "0.6875rem", fontWeight: 700, color: "#5a5a72", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #1a1a2e" }}>
        {isDM ? "Direct Messages" : contractId == null ? "Lobby Chat" : "Market Chat"}
      </p>

      <div ref={listRef} style={{ flex: 1, minHeight: "180px", maxHeight: "320px", overflowY: "auto", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {messages.length === 0 ? (
          <p style={{ margin: "auto", color: "#5a5a72", fontSize: "0.8125rem" }}>No messages yet — say hi 👋</p>
        ) : (
          messages.map((m) => {
            const mine = m.userId === currentUserId;
            return (
              <div key={m.id} style={{ fontSize: "0.8125rem", lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: mine ? "#818cf8" : "#22c55e", marginRight: "0.4rem" }}>
                  {m.username}
                </span>
                <span style={{ color: "#5a5a72", fontSize: "0.6875rem", marginRight: "0.4rem" }}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span style={{ color: "#e4e4ed", wordBreak: "break-word" }}>{m.body}</span>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={send} style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1rem", borderTop: "1px solid #1a1a2e" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          maxLength={500}
          disabled={sending}
          style={{ flex: 1, padding: "0.5rem 0.75rem", background: "#0a0a0f", border: "1px solid #2a2a3e", borderRadius: "0.375rem", color: "#e4e4ed", fontSize: "0.875rem", outline: "none", minWidth: 0 }}
        />
        <button
          type="submit"
          disabled={sending || text.trim().length === 0}
          style={{ padding: "0.5rem 1rem", background: "#6366f1", border: "none", borderRadius: "0.375rem", color: "#fff", fontSize: "0.875rem", fontWeight: 600, cursor: sending || text.trim().length === 0 ? "not-allowed" : "pointer", opacity: sending || text.trim().length === 0 ? 0.6 : 1 }}
        >
          Send
        </button>
      </form>
      {error && <p style={{ margin: 0, padding: "0 1rem 0.75rem", fontSize: "0.75rem", color: "#ef4444" }}>{error}</p>}
    </div>
  );
}
