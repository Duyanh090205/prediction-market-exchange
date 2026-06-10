"use client";

// "Message {player}" button on a player's profile — toggles a 1-1 direct-message
// thread (ChatPanel in DM mode). Lives on /players/[id] (#7 → private chat).

import { useState } from "react";
import ChatPanel, { ChatMessage } from "./ChatPanel";

interface PlayerChatProps {
  peerId: number;
  peerUsername: string;
  currentUserId: number;
  initialMessages: ChatMessage[];
}

export default function PlayerChat({ peerId, peerUsername, currentUserId, initialMessages }: PlayerChatProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "0.5rem 1rem",
          background: "rgba(99,102,241,0.12)",
          border: "1px solid rgba(99,102,241,0.4)",
          borderRadius: "0.5rem",
          color: "#818cf8",
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        💬 Message {peerUsername}
      </button>
    );
  }

  return (
    <div style={{ maxWidth: "520px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.8125rem", color: "#8888a0" }}>
          Private chat with <strong style={{ color: "#e4e4ed" }}>{peerUsername}</strong>
        </span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", color: "#5a5a72", cursor: "pointer", fontSize: "0.8125rem" }}
        >
          Hide
        </button>
      </div>
      <ChatPanel contractId={null} peerId={peerId} currentUserId={currentUserId} initialMessages={initialMessages} />
    </div>
  );
}
