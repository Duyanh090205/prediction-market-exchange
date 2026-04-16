"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={{
        padding: "0.375rem 0.875rem",
        background: "transparent",
        border: "1px solid #2a2a3e",
        borderRadius: "0.375rem",
        color: "#8888a0",
        fontSize: "0.8125rem",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#6366f1";
        (e.currentTarget as HTMLButtonElement).style.color = "#e4e4ed";
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a3e";
        (e.currentTarget as HTMLButtonElement).style.color = "#8888a0";
      }}
    >
      Sign Out
    </button>
  );
}
